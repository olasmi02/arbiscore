'use client';

import { useQuery } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import { CONTRACT_ADDRESSES } from '@/lib/web3/addresses';
import { ARBI_CREDIT_VAULT_ABI, ERC20_ABI, PRICE_ORACLE_ABI, STYLUS_ENGINE_ABI } from '@/lib/web3/abis';
import { useTxContext } from '@/lib/context/TxContext';
import { useMarket } from '@/lib/context/MarketContext';
import { evaluate } from '@/lib/scoring/evaluate';
import { scoreToTier } from '@/lib/math';
import type { BorrowerPersona } from '@/lib/types';

const engine = { address: CONTRACT_ADDRESSES.stylusEngine, abi: STYLUS_ENGINE_ABI } as const;
const usd = (x: bigint) => Number(x) / 1e6;
const eth = (x: bigint) => Number(x) / 1e18;

export interface MarketStats {
  ethPriceUSD: number;
  totalAssetsUSD: number;
  cashUSD: number;
  totalPrincipalUSD: number;
  utilization: number; // 0-1
  supplyApr: number; // 0-1
}

/** Pool-level stats; no wallet needed. */
export function useMarketStats() {
  const publicClient = usePublicClient();
  const { confirmedCount } = useTxContext();
  const { market } = useMarket();
  const vault = { address: market.vault, abi: ARBI_CREDIT_VAULT_ABI } as const;
  return useQuery({
    queryKey: ['market-stats', market.id, confirmedCount],
    enabled: Boolean(publicClient),
    refetchInterval: 30_000,
    queryFn: async (): Promise<MarketStats> => {
      const c = publicClient!;
      const [price, totalAssets, cash, util, supplyRate, principal] = await Promise.all([
        c.readContract({ address: CONTRACT_ADDRESSES.priceOracle, abi: PRICE_ORACLE_ABI, functionName: 'getEthPriceUSD' }),
        c.readContract({ ...vault, functionName: 'totalAssets' }),
        c.readContract({ address: market.asset, abi: ERC20_ABI, functionName: 'balanceOf', args: [market.vault] }),
        c.readContract({ ...vault, functionName: 'utilizationBps' }),
        c.readContract({ ...vault, functionName: 'supplyRateBps' }),
        c.readContract({ ...vault, functionName: 'totalPrincipal' }),
      ]);
      return {
        ethPriceUSD: eth(price),
        totalAssetsUSD: usd(totalAssets),
        cashUSD: usd(cash),
        totalPrincipalUSD: usd(principal),
        utilization: Number(util) / 10_000,
        supplyApr: Number(supplyRate) / 10_000,
      };
    },
  });
}

export interface OnChainBorrower {
  persona: BorrowerPersona;
  collateral: { depositedETH: number; lockedETH: number; freeETH: number };
  lender: { suppliedUSD: number; withdrawableUSD: number };
  wallet: { stable: number; weth: number }; // stable = the selected market's asset
  /** Score recomputed in the browser from on-chain history equals the Stylus engine's score. */
  scoreVerified: boolean;
  hasHistory: boolean;
  blockNumber: bigint;
}

/**
 * Reads the connected wallet's credit profile, loan history, vault positions and balances at a
 * single block, and re-runs the TypeScript port of the model to cross-check the engine's score.
 */
export function useOnChainBorrower() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { confirmedCount } = useTxContext();
  const { market } = useMarket();
  const vault = { address: market.vault, abi: ARBI_CREDIT_VAULT_ABI } as const;

  return useQuery({
    queryKey: ['onchain-borrower', address, market.id, confirmedCount],
    enabled: Boolean(isConnected && address && publicClient),
    refetchInterval: 30_000,
    queryFn: async (): Promise<OnChainBorrower> => {
      const c = publicClient!;
      const user = address!;
      const block = await c.getBlock();
      const at = { blockNumber: block.number };
      const token = (a: `0x${string}`) =>
        c.readContract({ address: a, abi: ERC20_ABI, functionName: 'balanceOf', args: [user], ...at });

      const [scoreAndTier, profile, history, deposited, locked, loanIds, shares, withdrawable, usdgBal, wethBal] =
        await Promise.all([
          c.readContract({ ...engine, functionName: 'getScoreAndTier', args: [user], ...at }),
          c.readContract({ ...engine, functionName: 'getProfile', args: [user], ...at }),
          c.readContract({ ...engine, functionName: 'getLoanHistory', args: [user], ...at }),
          c.readContract({ ...vault, functionName: 'userCollateral', args: [user], ...at }),
          c.readContract({ ...vault, functionName: 'userLockedCollateral', args: [user], ...at }),
          c.readContract({ ...vault, functionName: 'getUserLoanIds', args: [user], ...at }),
          c.readContract({ ...vault, functionName: 'balanceOf', args: [user], ...at }),
          c.readContract({ ...vault, functionName: 'maxWithdraw', args: [user], ...at }),
          token(market.asset),
          token(CONTRACT_ADDRESSES.weth),
        ]);
      const [suppliedAssets, vaultLoans, debts] = await Promise.all([
        c.readContract({ ...vault, functionName: 'convertToAssets', args: [shares], ...at }),
        Promise.all(loanIds.map((id) => c.readContract({ ...vault, functionName: 'loans', args: [id], ...at }))),
        Promise.all(loanIds.map((id) => c.readContract({ ...vault, functionName: 'debtOf', args: [id], ...at }))),
      ]);

      const [amounts, borrowTs, dueTs, closeTs, statuses] = history;
      const evaluation = evaluate({
        firstActivityTs: profile.firstActivityTimestamp,
        totalTxs: BigInt(profile.totalTransactions),
        volumeUsd: profile.totalVolumeUSD,
        loans: amounts.map((a, i) => ({ amountUsd: a, borrowTs: borrowTs[i], dueTs: dueTs[i], closeTs: closeTs[i], status: statuses[i] })),
        now: block.timestamp,
      });

      const chainScore = Number(scoreAndTier[0]);
      const tier = scoreToTier(chainScore);
      const nowSec = Number(block.timestamp);

      const persona: BorrowerPersona = {
        id: 'wallet',
        name: `${user.slice(0, 6)}…${user.slice(-4)}`,
        title: 'Connected Wallet',
        tagline: profile.isInitialized
          ? 'Live credit profile read from the Stylus engine on Arbitrum Sepolia'
          : 'No credit history yet: import your Aave history, or borrow and repay to build it',
        badge: 'Your Wallet',
        score: chainScore,
        tier: tier.name,
        tierNumber: tier.tier,
        collateralRatioBps: tier.ratioBps,
        ratioLabel: `${tier.ratioPercent}%`,
        metrics: evaluation.metrics,
        factors: evaluation.factors,
        mockAddress: user,
        activeLoans: vaultLoans
          .map((l, i) => {
            const days = Math.round((Number(l.dueDate) - nowSec) / 86_400);
            return {
              loanId: Number(l.loanId),
              amountUSDG: usd(l.principal),
              debtUSD: usd(debts[i]),
              aprPercent: l.aprBps / 100,
              collateralLockedETH: eth(l.collateralLocked),
              dueDateFormatted: days >= 0 ? `Due in ${days}d` : `${-days}d overdue`,
              status: (l.isLiquidated ? 'Liquidated' : l.isRepaid ? 'Repaid' : 'Active') as 'Active' | 'Repaid' | 'Liquidated',
            };
          })
          .reverse(),
      };

      return {
        persona,
        collateral: { depositedETH: eth(deposited), lockedETH: eth(locked), freeETH: eth(deposited - locked) },
        lender: { suppliedUSD: usd(suppliedAssets), withdrawableUSD: usd(withdrawable) },
        wallet: { stable: usd(usdgBal), weth: eth(wethBal) },
        scoreVerified: !profile.isInitialized || evaluation.score === chainScore,
        hasHistory: profile.isInitialized,
        blockNumber: block.number,
      };
    },
  });
}
