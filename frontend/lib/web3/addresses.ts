// Arbitrum Sepolia deployment (contracts/lending_vault/deployments.json); override via NEXT_PUBLIC_* env vars.
export const CONTRACT_ADDRESSES = {
  vault: (process.env.NEXT_PUBLIC_VAULT_ADDRESS ||
    '0x36ecc282A0536368E6af1c2b6020bd210e916b90') as `0x${string}`,
  stylusEngine: (process.env.NEXT_PUBLIC_STYLUS_ENGINE_ADDRESS ||
    '0x58Ba8a49d0A33ac334Bb7E65CD5c030DD19fAa8b') as `0x${string}`,
  usdg: (process.env.NEXT_PUBLIC_USDG_ADDRESS ||
    '0xFFC95faa3d63Cde504a05B567C600B78C0b41892') as `0x${string}`,
  weth: (process.env.NEXT_PUBLIC_WETH_ADDRESS ||
    '0x3234F280192CF69599A4272001AD76d1bfdCfbEf') as `0x${string}`,
  priceOracle: (process.env.NEXT_PUBLIC_ORACLE_ADDRESS ||
    '0xB17b872B2A7c675D72A614FCB8C260F4c398BcE2') as `0x${string}`,
  creditImporter: (process.env.NEXT_PUBLIC_CREDIT_IMPORTER_ADDRESS ||
    '0x3b7AF3962eA7177e9cB22c67231a2E4360a22cB8') as `0x${string}`,
} as const;

export const USDG_FAUCET_URL = 'https://faucet.paxos.com/';
