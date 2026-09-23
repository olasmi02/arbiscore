// Arbitrum Sepolia deployment (contracts/lending_vault/deployments.json); override via NEXT_PUBLIC_* env vars.
export const CONTRACT_ADDRESSES = {
  stylusEngine: (process.env.NEXT_PUBLIC_STYLUS_ENGINE_ADDRESS ||
    '0xd60CF3F65E7a219aF4c992672AC16d572e055405') as `0x${string}`,
  weth: (process.env.NEXT_PUBLIC_WETH_ADDRESS ||
    '0xE78BD7a9D205ec879f3550B4a23a3accA7002384') as `0x${string}`,
  priceOracle: (process.env.NEXT_PUBLIC_ORACLE_ADDRESS ||
    '0x747459E754c6dcc3Aad80275d20B85766F148C0C') as `0x${string}`,
  creditImporter: (process.env.NEXT_PUBLIC_CREDIT_IMPORTER_ADDRESS ||
    '0xba4eC290ec6f872D3864E1B7489741f43602Eb1E') as `0x${string}`,
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
    vault: (process.env.NEXT_PUBLIC_VAULT_ADDRESS || '0xdca912bc96a99806a8cF53bfdFBC41B8e0b92C3e') as `0x${string}`,
    asset: (process.env.NEXT_PUBLIC_USDG_ADDRESS || '0xFFC95faa3d63Cde504a05B567C600B78C0b41892') as `0x${string}`,
    hasTokenFaucet: false,
  },
  USDC: {
    id: 'USDC',
    symbol: 'USDC',
    label: 'Test USDC',
    vault: (process.env.NEXT_PUBLIC_VAULT_USDC_ADDRESS || '0xe82e14050F25Cb798C93A72407D2B8E079133C6f') as `0x${string}`,
    asset: (process.env.NEXT_PUBLIC_TEST_USDC_ADDRESS || '0x01997b100e67F927b9091055A237b6404143c9Ac') as `0x${string}`,
    hasTokenFaucet: true,
  },
};

/** Markets with a configured deployment. */
export const AVAILABLE_MARKETS = Object.values(MARKETS).filter((m) => m.vault && m.asset);
