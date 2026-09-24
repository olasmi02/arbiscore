import { type Chain } from 'viem';

/**
 * RPC the dashboard itself reads through. It may be a private, referrer-locked endpoint, so it is
 * never put in the chain definition: wallets add the chain with the public RPC below, and they call
 * it from the extension, where a referrer-locked endpoint would reject them.
 */
export const APP_RPC_URL = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc';

export const arbitrumSepolia = {
  id: 421614,
  name: 'Arbitrum Sepolia',
  nativeCurrency: {
    name: 'Arbitrum Sepolia Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://sepolia-rollup.arbitrum.io/rpc'],
    },
    public: {
      http: ['https://sepolia-rollup.arbitrum.io/rpc'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Arbiscan',
      url: 'https://sepolia.arbiscan.io',
      apiUrl: 'https://api-sepolia.arbiscan.io/api',
    },
  },
  testnet: true,
} as const satisfies Chain;
