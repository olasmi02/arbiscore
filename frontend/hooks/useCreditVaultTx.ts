'use client';

import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { parseEther, parseUnits, maxUint256, type Hash } from 'viem';
import { CONTRACT_ADDRESSES } from '@/lib/web3/addresses';
import { ARBI_CREDIT_VAULT_ABI, CREDIT_IMPORTER_ABI, ERC20_ABI, STYLUS_ENGINE_ABI } from '@/lib/web3/abis';
import { BorrowerPersona } from '@/lib/types';
import { useTxContext } from '@/lib/context/TxContext';

export type { TxLifecycleStep, TxStatusState } from '@/lib/context/TxContext';

const USDG_DECIMALS = 6;

export function useCreditVaultTx(onSuccessCallback?: () => void) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { txStatus, setTxStatus, resetTx } = useTxContext();

  const ready = Boolean(address && walletClient && publicClient);

  /** Ensures the vault may pull `amount` of `token`, prompting an approval if needed. */
  const ensureAllowance = async (token: `0x${string}`, amount: bigint, label: string) => {
    const allowance = await publicClient!.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [address!, CONTRACT_ADDRESSES.vault],
    });
    if (allowance >= amount) return;
    setTxStatus({ step: 'signing_approval', actionTitle: `Approve ${label}` });
    const hash = await walletClient!.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [CONTRACT_ADDRESSES.vault, maxUint256],
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
    if (!ready) return;
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
        errorMessage: err?.shortMessage || err?.message || 'Transaction rejected',
      });
    }
  };

  const vaultWrite = (functionName: string, args: readonly unknown[]) =>
    walletClient!.writeContract({ address: CONTRACT_ADDRESSES.vault, abi: ARBI_CREDIT_VAULT_ABI, functionName, args } as any);

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
          address: CONTRACT_ADDRESSES.vault,
          abi: ARBI_CREDIT_VAULT_ABI,
          functionName: 'getFreeCollateral',
          args: [address!],
        });
        if (free === 0n) throw new Error('No free collateral to withdraw');
        return vaultWrite('withdrawCollateral', [free]);
      }
    );

  // --- Borrowing ---
  const borrowUSDG = (amountUSD: string) =>
    run(
      { sign: 'Initiate USDG Borrow', pending: 'Originating USDG Loan...', done: 'Loan Originated!', failed: 'Borrow Failed' },
      () => vaultWrite('borrow', [parseUnits(amountUSD, USDG_DECIMALS)])
    );

  /** Repays principal + interest. Interest accrues until the tx is mined, so approve with headroom. */
  const repayLoan = (loanId: bigint) =>
    run(
      { sign: 'Repay Loan (principal + interest)', pending: 'Recording repayment in the Stylus engine...', done: 'Loan Repaid!', failed: 'Repayment Failed' },
      () => vaultWrite('repay', [loanId]),
      async () => {
        const debt = await publicClient!.readContract({
          address: CONTRACT_ADDRESSES.vault,
          abi: ARBI_CREDIT_VAULT_ABI,
          functionName: 'debtOf',
          args: [loanId],
        });
        await ensureAllowance(CONTRACT_ADDRESSES.usdg, (debt * 101n) / 100n, 'USDG Repayment');
      }
    );

  // --- Lending (ERC-4626) ---
  const supplyUSDG = (amountUSD: string) => {
    const assets = parseUnits(amountUSD, USDG_DECIMALS);
    return run(
      { sign: 'Supply USDG to the Pool', pending: 'Minting asUSDG lending shares...', done: 'USDG supplied: now earning interest!', failed: 'Supply Failed' },
      () => vaultWrite('deposit', [assets, address!]),
      () => ensureAllowance(CONTRACT_ADDRESSES.usdg, assets, 'USDG')
    );
  };

  const withdrawAllUSDG = () =>
    run(
      { sign: 'Withdraw Supplied USDG', pending: 'Redeeming asUSDG shares...', done: 'USDG Withdrawn!', failed: 'Withdrawal Failed' },
      async () => {
        const shares = await publicClient!.readContract({
          address: CONTRACT_ADDRESSES.vault,
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
        walletClient!.writeContract({
          address: CONTRACT_ADDRESSES.weth,
          abi: ERC20_ABI,
          functionName: 'faucet',
          args: [address!, parseEther('2')],
        })
    );

  /** Writes a sandbox persona's loan history to the connected wallet (engine demo mode). */
  const syncPersonaOnChain = (persona: BorrowerPersona) => {
    const profile = persona.profile;
    if (!profile) return Promise.resolve();
    return run(
      { sign: `Sync ${persona.name} On-Chain`, pending: `Writing ${persona.badge} history to the Stylus engine...`, done: `Profile synced: on-chain score ${persona.score}.`, failed: 'Sync Failed' },
      () =>
        walletClient!.writeContract({
          address: CONTRACT_ADDRESSES.stylusEngine,
          abi: STYLUS_ENGINE_ABI,
          functionName: 'setMockProfile',
          args: [
            address!,
            profile.ageDays,
            profile.totalTransactions,
            BigInt(profile.totalVolumeUSD),
            profile.loans.map((l) => BigInt(l.amountUsd)),
            profile.loans.map((l) => l.borrowedDaysAgo),
            profile.loans.map((l) => l.status),
            profile.loans.map((l) => l.daysLate),
          ],
        })
    );
  };

  /** Portable credit: fetch a signed attestation of Aave V3 history and import it on-chain. */
  const importAaveCredit = (demoSource?: string) =>
    run(
      { sign: 'Import Aave Credit History', pending: 'Verifying attestation and scoring in Stylus...', done: 'Aave history imported and scored!', failed: 'Import Failed' },
      async () => {
        setTxStatus({ step: 'signing_action', actionTitle: 'Indexing Aave V3 history on Arbitrum One...' });
        const qs = new URLSearchParams({ address: address! });
        if (demoSource) qs.set('demoSource', demoSource);
        const res = await fetch(`/api/attest?${qs}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? 'Attestation failed');
        const a = body.attestation;
        setTxStatus({ step: 'signing_action', actionTitle: `Import ${a.amountsUsd.length} attested Aave loans` });
        return walletClient!.writeContract({
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

  return {
    txStatus,
    resetTx,
    depositCollateral,
    withdrawFreeCollateral,
    borrowUSDG,
    repayLoan,
    supplyUSDG,
    withdrawAllUSDG,
    claimTestWeth,
    syncPersonaOnChain,
    importAaveCredit,
  };
}
