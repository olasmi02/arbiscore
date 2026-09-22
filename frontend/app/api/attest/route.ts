import { NextResponse } from 'next/server';
import { getAddress, isAddress, keccak256, encodeAbiParameters, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readAaveHistory } from '@/lib/attest/aaveHistory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ATTESTATION_TTL_SECONDS = 3600;

const TYPES = {
  CreditAttestation: [
    { name: 'user', type: 'address' },
    { name: 'ageDays', type: 'uint32' },
    { name: 'txCount', type: 'uint32' },
    { name: 'volumeUsd', type: 'uint256' },
    { name: 'loansHash', type: 'bytes32' },
    { name: 'source', type: 'string' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

/**
 * GET /api/attest?address=0x...[&demoSource=0x...]
 *
 * Indexes the wallet's Aave V3 history on Arbitrum One and returns an EIP-712 attestation the
 * wallet can submit to CreditImporter on Arbitrum Sepolia. With ALLOW_DEMO_SOURCE=true (testnet
 * demos only), `demoSource` imports another public wallet's history; the attestation's `source`
 * records this, so it is visible on-chain.
 */
export async function GET(req: Request) {
  const key = process.env.ATTESTER_PRIVATE_KEY as `0x${string}` | undefined;
  const importer = process.env.NEXT_PUBLIC_CREDIT_IMPORTER_ADDRESS as Address | undefined;
  if (!key || !importer) {
    return NextResponse.json({ error: 'Attester is not configured on this deployment.' }, { status: 503 });
  }

  const params = new URL(req.url).searchParams;
  const address = params.get('address');
  const demoSource = params.get('demoSource');
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: 'Invalid address.' }, { status: 400 });
  }
  if (demoSource && (process.env.ALLOW_DEMO_SOURCE !== 'true' || !isAddress(demoSource))) {
    return NextResponse.json({ error: 'Demo source imports are disabled.' }, { status: 403 });
  }

  const user = getAddress(address);
  const historyOf = demoSource ? getAddress(demoSource) : user;
  const now = Math.floor(Date.now() / 1000);

  let history;
  try {
    history = await readAaveHistory(historyOf, now);
  } catch (e) {
    return NextResponse.json({ error: `Could not read Aave history: ${(e as Error).message}` }, { status: 502 });
  }
  if (history.amountsUsd.length === 0) {
    return NextResponse.json(
      { error: 'No closed Aave V3 loans (held 14+ days) found for this wallet on Arbitrum One.', summary: history.summary },
      { status: 404 }
    );
  }

  const attestation = {
    user,
    ageDays: history.ageDays,
    txCount: history.txCount,
    volumeUsd: history.volumeUsd,
    amountsUsd: history.amountsUsd,
    borrowedDaysAgo: history.borrowedDaysAgo,
    statuses: history.statuses,
    daysLate: history.daysLate,
    source: demoSource ? `aave-v3-arbitrum:demo:${historyOf}` : 'aave-v3-arbitrum',
    deadline: BigInt(now + ATTESTATION_TTL_SECONDS),
  };
  const loansHash = keccak256(
    encodeAbiParameters(
      [{ type: 'uint64[]' }, { type: 'uint32[]' }, { type: 'uint8[]' }, { type: 'uint32[]' }],
      [attestation.amountsUsd, attestation.borrowedDaysAgo, attestation.statuses, attestation.daysLate]
    )
  );
  const signature = await privateKeyToAccount(key).signTypedData({
    domain: { name: 'ArbiScore CreditImporter', version: '1', chainId: 421614, verifyingContract: importer },
    types: TYPES,
    primaryType: 'CreditAttestation',
    message: {
      user,
      ageDays: attestation.ageDays,
      txCount: attestation.txCount,
      volumeUsd: attestation.volumeUsd,
      loansHash,
      source: attestation.source,
      deadline: attestation.deadline,
    },
  });

  // bigint -> string for JSON
  return NextResponse.json({
    attestation: {
      ...attestation,
      volumeUsd: attestation.volumeUsd.toString(),
      amountsUsd: attestation.amountsUsd.map(String),
      deadline: attestation.deadline.toString(),
    },
    signature,
    summary: history.summary,
    historyOf,
  });
}
