// Arbitrum Sepolia deployment (contracts/lending_vault/deployments.json); override via NEXT_PUBLIC_* env vars.
export const CONTRACT_ADDRESSES = {
  stylusEngine: (process.env.NEXT_PUBLIC_STYLUS_ENGINE_ADDRESS ||
    '0x52C5B587c4dAB33294Dfb04200c74940D2D4B7f4') as `0x${string}`,
  weth: (process.env.NEXT_PUBLIC_WETH_ADDRESS ||
    '0x193Ac2555f46900eFf2f2E5cE335AB12f4Ebbc97') as `0x${string}`,
  priceOracle: (process.env.NEXT_PUBLIC_ORACLE_ADDRESS ||
    '0x3005dE0C1ad764BbD4BF58A9D7c324BC30605e0E') as `0x${string}`,
  creditImporter: (process.env.NEXT_PUBLIC_CREDIT_IMPORTER_ADDRESS ||
    '0xfabA30b9D826a5Bb41245E4E7Be323A5f7901BC9') as `0x${string}`,
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
    vault: (process.env.NEXT_PUBLIC_VAULT_ADDRESS || '0xB1e571c2fe06156A1DE45D6Af4A6807118E0B94E') as `0x${string}`,
    asset: (process.env.NEXT_PUBLIC_USDG_ADDRESS || '0xFFC95faa3d63Cde504a05B567C600B78C0b41892') as `0x${string}`,
    hasTokenFaucet: false,
  },
  USDC: {
    id: 'USDC',
    symbol: 'USDC',
    label: 'Test USDC',
    vault: (process.env.NEXT_PUBLIC_VAULT_USDC_ADDRESS || '0x84b7BdA8d5e94DFdB90D8Cf2Aa50532621E31303') as `0x${string}`,
    asset: (process.env.NEXT_PUBLIC_TEST_USDC_ADDRESS || '0xDA7A4bB5b6c00ad879ba3eDC841a10a6899A0DE1') as `0x${string}`,
    hasTokenFaucet: true,
  },
};

/** Markets with a configured deployment. */
export const AVAILABLE_MARKETS = Object.values(MARKETS).filter((m) => m.vault && m.asset);
