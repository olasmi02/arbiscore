// Arbitrum Sepolia deployment (contracts/lending_vault/deployments.json); override via NEXT_PUBLIC_* env vars.
export const CONTRACT_ADDRESSES = {
  stylusEngine: (process.env.NEXT_PUBLIC_STYLUS_ENGINE_ADDRESS ||
    '0x74f0AAf83A7536c4350aA4C8Bb7bb474C734b789') as `0x${string}`,
  weth: (process.env.NEXT_PUBLIC_WETH_ADDRESS ||
    '0xeE5057852E7bB54A97166ac4e127a87a5aBa6A2D') as `0x${string}`,
  priceOracle: (process.env.NEXT_PUBLIC_ORACLE_ADDRESS ||
    '0xd9BB4b32842c4bAd33978A2332317Ec9FB9492C0') as `0x${string}`,
  creditImporter: (process.env.NEXT_PUBLIC_CREDIT_IMPORTER_ADDRESS ||
    '0x762b435a3368D6718Ac27d5B18Fb5F5D8Be10264') as `0x${string}`,
} as const;

export const USDG_FAUCET_URL = 'https://faucet.paxos.com/';

export type MarketId = 'USDG' | 'USDC';

export interface MarketConfig {
  id: MarketId;
  symbol: string; // borrow/lend asset symbol
  label: string;
  vault: `0x${string}`;
  asset: `0x${string}`;
  /** Test token with a public faucet() (false for real Paxos USDG). */
  hasTokenFaucet: boolean;
}

/** Two markets share one Stylus credit engine: a repayment in either improves terms in both. */
export const MARKETS: Record<MarketId, MarketConfig> = {
  USDG: {
    id: 'USDG',
    symbol: 'USDG',
    label: 'Paxos USDG',
    vault: (process.env.NEXT_PUBLIC_VAULT_ADDRESS || '0xa247e6c396ECFE7485Cd54226AD7F49064F9a36c') as `0x${string}`,
    asset: (process.env.NEXT_PUBLIC_USDG_ADDRESS || '0xFFC95faa3d63Cde504a05B567C600B78C0b41892') as `0x${string}`,
    hasTokenFaucet: false,
  },
  USDC: {
    id: 'USDC',
    symbol: 'USDC',
    label: 'Test USDC',
    vault: (process.env.NEXT_PUBLIC_VAULT_USDC_ADDRESS || '0x94a31d0F82b2EC877CAb40140582a175b68a6315') as `0x${string}`,
    asset: (process.env.NEXT_PUBLIC_TEST_USDC_ADDRESS || '0xA471D9501c13Dbb1dC9D5f5039c4f934310dAb5d') as `0x${string}`,
    hasTokenFaucet: true,
  },
};

/** Markets with a configured deployment. */
export const AVAILABLE_MARKETS = Object.values(MARKETS).filter((m) => m.vault && m.asset);
