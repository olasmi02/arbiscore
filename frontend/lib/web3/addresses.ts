// Arbitrum Sepolia deployment (contracts/lending_vault/deployments.json); override via NEXT_PUBLIC_* env vars.
export const CONTRACT_ADDRESSES = {
  stylusEngine: (process.env.NEXT_PUBLIC_STYLUS_ENGINE_ADDRESS ||
    '0xC827c39005225ce0B37D481D1d912fEE84442a6d') as `0x${string}`,
  weth: (process.env.NEXT_PUBLIC_WETH_ADDRESS ||
    '0x20e7ccCa353F65191f954452bdf41602feBdB881') as `0x${string}`,
  priceOracle: (process.env.NEXT_PUBLIC_ORACLE_ADDRESS ||
    '0x5573d5eb3ea48a47cCdee4A70Df479078c5e6923') as `0x${string}`,
  creditImporter: (process.env.NEXT_PUBLIC_CREDIT_IMPORTER_ADDRESS ||
    '0xf6A82D50DB3322AAA8C2569Bdc843C991ffEF09f') as `0x${string}`,
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
    vault: (process.env.NEXT_PUBLIC_VAULT_ADDRESS || '0x38BA65470F26C804DEE555FD9F4F9c2F0805Fd08') as `0x${string}`,
    asset: (process.env.NEXT_PUBLIC_USDG_ADDRESS || '0xFFC95faa3d63Cde504a05B567C600B78C0b41892') as `0x${string}`,
    hasTokenFaucet: false,
  },
  USDC: {
    id: 'USDC',
    symbol: 'USDC',
    label: 'Test USDC',
    vault: (process.env.NEXT_PUBLIC_VAULT_USDC_ADDRESS || '0xEd52c7F44bf5ddcD1b512B85CC0aA5C4021084aF') as `0x${string}`,
    asset: (process.env.NEXT_PUBLIC_TEST_USDC_ADDRESS || '0x9B303fEfA3947e3094e0c759039281d7e748E413') as `0x${string}`,
    hasTokenFaucet: true,
  },
};

/** Markets with a configured deployment. */
export const AVAILABLE_MARKETS = Object.values(MARKETS).filter((m) => m.vault && m.asset);
