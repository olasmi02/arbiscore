import { NextResponse } from 'next/server';
import { getAddress, isAddress, keccak256, encodeAbiParameters, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readAaveHistory } from '@/lib/attest/aaveHistory';
import { CONTRACT_ADDRESSES } from '@/lib/web3/addresses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // indexing a real Aave history can take 10-30s

/**
 * Fixed public Aave V3 (Arbitrum One) borrowers for demo imports. Only these can be imported into
 * a different wallet, and only for allowlisted wallets (DEMO_WALLETS) or with the judges' access
 * code (DEMO_ACCESS_CODE). Anyone can always import their OWN history.
 */
const DEMO_SOURCES = {
  good: '0x699e74955b470C24f9a80ce60Ce0a8FFa747b897', // ~24 repaid loans over ~20 months → Prime
  bad: '0xAFb1DCD9692019c7f17788ceBaBc002cc6EfDCD9', // ~$34k borrowed, liquidated → Subprime
} as const;
type DemoKind = keyof typeof DEMO_SOURCES;

function demoAllowed(user: string, code: string | null): boolean {
  const wallets = (process.env.DEMO_WALLETS ?? '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  if (wallets.includes(user.toLowerCase())) return true;
  const expected = process.env.DEMO_ACCESS_CODE;
  return Boolean(expected && code && code.trim().toUpperCase() === expected.trim().toUpperCase());
}

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
 * GET /api/attest?address=0x...[&demo=good|bad&code=...]
 *
 * Indexes the wallet's Aave V3 history on Arbitrum One and returns an EIP-712 attestation the
 * wallet can submit to CreditImporter on Arbitrum Sepolia. `demo` imports one of the fixed demo
 * borrowers instead (gated, see above); the attestation's `source` records this on-chain.
 */
export async function GET(req: Request) {
  const key = process.env.ATTESTER_PRIVATE_KEY as `0x${string}` | undefined;
  const importer = CONTRACT_ADDRESSES.creditImporter as Address; // env override or the deployed default
  if (!key) {
    return NextResponse.json({ error: 'Attester is not configured on this deployment (set ATTESTER_PRIVATE_KEY).' }, { status: 503 });
  }

  const params = new URL(req.url).searchParams;
  const address = params.get('address');
  const demo = params.get('demo');
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: 'Invalid address.' }, { status: 400 });
  }
  if (demo && !(demo in DEMO_SOURCES)) {
    return NextResponse.json({ error: 'Unknown demo borrower.' }, { status: 400 });
  }
  if (demo && !demoAllowed(address, params.get('code'))) {
    return NextResponse.json(
      { error: 'Demo imports need a judge access code (or an allowlisted demo wallet). Anyone can import their own Aave history.' },
      { status: 403 }
    );
  }

  const user = getAddress(address);
  const demoSource = demo ? DEMO_SOURCES[demo as DemoKind] : null;
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
