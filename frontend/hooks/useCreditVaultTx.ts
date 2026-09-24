'use client';

import { useRef } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { getWalletClient } from 'wagmi/actions';
import { parseEther, parseUnits, maxUint256, type Hash } from 'viem';
import { CONTRACT_ADDRESSES } from '@/lib/web3/addresses';
import { ARBI_CREDIT_VAULT_ABI, CREDIT_IMPORTER_ABI, ERC20_ABI } from '@/lib/web3/abis';
import { describeTxError, KNOWN_ERRORS } from '@/lib/web3/txErrors';
import { useTxContext } from '@/lib/context/TxContext';
import { useMarket } from '@/lib/context/MarketContext';
import { arbitrumSepolia } from '@/lib/web3/chains';
import { wagmiConfig } from '@/lib/web3/config';

export type { TxLifecycleStep, TxStatusState } from '@/lib/context/TxContext';

const STABLE_DECIMALS = 6; // USDG and test USDC

export function useCreditVaultTx(onSuccessCallback?: () => void) {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { txStatus, setTxStatus, resetTx } = useTxContext();
  const { market } = useMarket();
  const sym = market.symbol;

  // The wallet client used by the running action. useWalletClient can stay empty for some injected
  // wallets, so run() falls back to asking the connector for one when the action starts.
  const clientRef = useRef<NonNullable<typeof walletClient> | null>(null);

  /** Ensures the vault may pull `amount` of `token`, prompting an approval if needed. */
  const ensureAllowance = async (token: `0x${string}`, amount: bigint, label: string) => {
    const allowance = await publicClient!.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [address!, market.vault],
    });
    if (allowance >= amount) return;
    setTxStatus({ step: 'signing_approval', actionTitle: `Approve ${label}` });
    const hash = await clientRef.current!.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [market.vault, maxUint256],
    });
    setTxStatus({ step: 'pending_approval', actionTitle: `Approving ${label}...`, approvalHash: hash });
    await publicClient!.waitForTransactionReceipt({ hash });
  };

  /** Runs one user action through the shared signing → pending → confirmed/failed lifecycle. */
  const run = async (
    titles: { sign: string; pending: string; done: string; failed: string },
    action: () => Promise<Hash>,
    before?: () => Promise<void>
  ) => {
    // Never fail silently: say why the action can't start
    const fail = (errorMessage: string) => setTxStatus({ step: 'failed', actionTitle: titles.failed, errorMessage });
    if (!address) return fail('Connect a wallet first.');
    if (chainId !== arbitrumSepolia.id)
      return fail('Your wallet is on another network. Switch it to Arbitrum Sepolia (chain 421614) and try again.');
    if (!publicClient) return fail('Could not reach Arbitrum Sepolia. Check your connection and try again.');
    let client = walletClient ?? null;
    if (!client) {
      try {
        client = await getWalletClient(wagmiConfig, { chainId: arbitrumSepolia.id, account: address });
      } catch (err: any) {
        console.error('Wallet client unavailable:', err);
        return fail(`Your wallet did not respond: ${err?.shortMessage ?? err?.message ?? 'unknown error'}. Reconnect the wallet and try again.`);
      }
    }
    clientRef.current = client;
    try {
      if (before) await before();
      setTxStatus({ step: 'signing_action', actionTitle: titles.sign });
      const hash = await action();
      setTxStatus({ step: 'pending_action', actionTitle: titles.pending, txHash: hash });
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction reverted on-chain');
      setTxStatus({ step: 'confirmed', actionTitle: titles.done, txHash: hash });
      onSuccessCallback?.();
    } catch (err: any) {
      console.error(`${titles.failed}:`, err);
      setTxStatus({
        step: 'failed',
        actionTitle: titles.failed,
        errorMessage: describeTxError(err),
      });
    }
  };

  /**
   * Simulates first so a doomed transaction fails before the wallet prompt, with the contract's
   * error decoded (the error ABI covers reverts bubbling up from the engine, oracle and OZ bases).
   */
  const send = async (req: { address: `0x${string}`; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }) => {
    const { request } = await publicClient!.simulateContract({
      ...req,
      abi: [...req.abi, ...KNOWN_ERRORS],
      account: address!,
    } as any);
    return clientRef.current!.writeContract(request as any);
  };

  const vaultWrite = (functionName: string, args: readonly unknown[]) =>
    send({ address: market.vault, abi: ARBI_CREDIT_VAULT_ABI, functionName, args });

  // --- Collateral ---
  const depositCollateral = (amountETH: string) => {
    const wei = parseEther(amountETH);
    return run(
      { sign: 'Confirm Collateral Deposit', pending: 'Locking WETH in Escrow...', done: 'Collateral Deposited!', failed: 'Deposit Failed' },
      () => vaultWrite('depositCollateral', [wei]),
      () => ensureAllowance(CONTRACT_ADDRESSES.weth, wei, 'WETH Collateral')
    );
  };

  const withdrawFreeCollateral = () =>
    run(
      { sign: 'Withdraw Free Collateral', pending: 'Releasing WETH from Escrow...', done: 'Collateral Withdrawn!', failed: 'Withdrawal Failed' },
      async () => {
        const free = await publicClient!.readContract({
          address: market.vault,
          abi: ARBI_CREDIT_VAULT_ABI,
          functionName: 'getFreeCollateral',
          args: [address!],
        });
        if (free === 0n) throw new Error('No free collateral to withdraw');
        return vaultWrite('withdrawCollateral', [free]);
      }
    );

  // --- Borrowing ---
  const borrow = (amountUSD: string) =>
    run(
      { sign: `Borrow ${sym}`, pending: `Originating ${sym} loan...`, done: 'Loan Originated!', failed: 'Borrow Failed' },
      () => vaultWrite('borrow', [parseUnits(amountUSD, STABLE_DECIMALS)])
    );

  /** Repays principal + interest. Interest accrues until the tx is mined, so approve with headroom. */
  const repayLoan = (loanId: bigint) =>
    run(
      { sign: 'Repay Loan (principal + interest)', pending: 'Recording repayment in the Stylus engine...', done: 'Loan Repaid!', failed: 'Repayment Failed' },
      () => vaultWrite('repay', [loanId]),
      async () => {
        const debt = await publicClient!.readContract({
          address: market.vault,
          abi: ARBI_CREDIT_VAULT_ABI,
          functionName: 'debtOf',
          args: [loanId],
        });
        await ensureAllowance(market.asset, (debt * 101n) / 100n, `${sym} Repayment`);
      }
    );

  // --- Lending (ERC-4626) ---
  const supply = (amountUSD: string) => {
    const assets = parseUnits(amountUSD, STABLE_DECIMALS);
    return run(
      { sign: `Supply ${sym} to the Pool`, pending: `Minting as${sym} lending shares...`, done: `${sym} supplied: now earning interest!`, failed: 'Supply Failed' },
      () => vaultWrite('deposit', [assets, address!]),
      () => ensureAllowance(market.asset, assets, sym)
    );
  };

  const withdrawSupply = () =>
    run(
      { sign: `Withdraw Supplied ${sym}`, pending: `Redeeming as${sym} shares...`, done: `${sym} Withdrawn!`, failed: 'Withdrawal Failed' },
      async () => {
        const shares = await publicClient!.readContract({
          address: market.vault,
          abi: ARBI_CREDIT_VAULT_ABI,
          functionName: 'maxRedeem',
          args: [address!],
        });
        if (shares === 0n) throw new Error('Nothing withdrawable right now (funds may be lent out)');
        return vaultWrite('redeem', [shares, address!, address!]);
      }
    );

  // --- Testnet helpers ---
  const claimTestWeth = () =>
    run(
      { sign: 'Claim 2 Test WETH', pending: 'Minting test WETH collateral...', done: 'Claimed 2 test WETH!', failed: 'Faucet Failed' },
      () =>
        send({
          address: CONTRACT_ADDRESSES.weth,
          abi: ERC20_ABI,
          functionName: 'faucet',
          args: [address!, parseEther('2')],
        })
    );

  /** Test USDC faucet (the USDG market uses real Paxos testnet USDG). */
  const claimTestStable = () =>
    run(
      { sign: `Claim 1,000 test ${sym}`, pending: `Minting test ${sym}...`, done: `Claimed 1,000 test ${sym}!`, failed: 'Faucet Failed' },
      () =>
        send({
          address: market.asset,
          abi: ERC20_ABI,
          functionName: 'faucet',
          args: [address!, parseUnits('1000', STABLE_DECIMALS)],
        })
    );

  /** Portable credit: fetch a signed attestation of Aave V3 history and import it on-chain. */
  const importAaveCredit = (demo?: 'good' | 'bad', code?: string) => {
    if (demo && !code?.trim()) {
      setTxStatus({
        step: 'failed',
        actionTitle: 'Import Failed',
        errorMessage: 'The demo imports need the judge access code. Enter it in the box first, or import your own Aave history instead.',
      });
      return;
    }
    return run(
      { sign: 'Import Aave Credit History', pending: 'Verifying attestation and scoring in Stylus...', done: 'Aave history imported and scored!', failed: 'Import Failed' },
      async () => {
        setTxStatus({ step: 'signing_action', actionTitle: 'Indexing Aave V3 history on Arbitrum One...' });
        const qs = new URLSearchParams({ address: address! });
        if (demo) qs.set('demo', demo);
        if (code) qs.set('code', code);
        const res = await fetch(`/api/attest?${qs}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? 'Attestation failed');
        const a = body.attestation;
        setTxStatus({ step: 'signing_action', actionTitle: `Import ${a.amountsUsd.length} attested Aave loans` });
        return send({
          address: CONTRACT_ADDRESSES.creditImporter,
          abi: CREDIT_IMPORTER_ABI,
          functionName: 'importCredit',
          args: [
            {
              ...a,
              volumeUsd: BigInt(a.volumeUsd),
              amountsUsd: a.amountsUsd.map((x: string) => BigInt(x)),
              deadline: BigInt(a.deadline),
            },
            body.signature,
          ],
        });
      }
    );
  };

  return {
    txStatus,
    resetTx,
    depositCollateral,
    withdrawFreeCollateral,
    borrow,
    repayLoan,
    supply,
    withdrawSupply,
    claimTestWeth,
    claimTestStable,
    importAaveCredit,
  };
}
