// Arbitrum Sepolia deployment (contracts/lending_vault/deployments.json); override via NEXT_PUBLIC_* env vars.
export const CONTRACT_ADDRESSES = {
  stylusEngine: (process.env.NEXT_PUBLIC_STYLUS_ENGINE_ADDRESS ||
    '0xA8E32a9128a24eAECd4e9075A1fa4dda9DD1250b') as `0x${string}`,
  weth: (process.env.NEXT_PUBLIC_WETH_ADDRESS ||
    '0x86Eb3A5BBAB09Df84a26B681593E4c14F45053bD') as `0x${string}`,
  priceOracle: (process.env.NEXT_PUBLIC_ORACLE_ADDRESS ||
    '0xBeB7D2D75184F3c3B405F28448C02050859aF910') as `0x${string}`,
  creditImporter: (process.env.NEXT_PUBLIC_CREDIT_IMPORTER_ADDRESS ||
    '0xf494Cd15Ad8439df3997B56192812D5330D8E8e5') as `0x${string}`,
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
    vault: (process.env.NEXT_PUBLIC_VAULT_ADDRESS || '0x7A7a4B77597A36958055DC4652eAb542a8466e6A') as `0x${string}`,
    asset: (process.env.NEXT_PUBLIC_USDG_ADDRESS || '0xFFC95faa3d63Cde504a05B567C600B78C0b41892') as `0x${string}`,
    hasTokenFaucet: false,
  },
  USDC: {
    id: 'USDC',
    symbol: 'USDC',
    label: 'Test USDC',
    vault: (process.env.NEXT_PUBLIC_VAULT_USDC_ADDRESS || '0x846e488015b64dfE09ECeEa7996A1b3165B67541') as `0x${string}`,
    asset: (process.env.NEXT_PUBLIC_TEST_USDC_ADDRESS || '0xA488f89cE03A00E214C216Efd1F68E9960042379') as `0x${string}`,
    hasTokenFaucet: true,
  },
};

/** Markets with a configured deployment. */
export const AVAILABLE_MARKETS = Object.values(MARKETS).filter((m) => m.vault && m.asset);
