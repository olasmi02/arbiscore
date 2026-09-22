import { http, createConfig } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { arbitrumSepolia } from './chains';

export const wagmiConfig = createConfig({
  chains: [arbitrumSepolia],
  connectors: [
    injected({
      target() {
        return {
          id: 'injected',
          name: 'Browser Wallet (MetaMask / Rabby)',
          provider: typeof window !== 'undefined' ? (window as any).ethereum : undefined,
        };
      },
    }),
  ],
  ssr: true,
  transports: {
    [arbitrumSepolia.id]: http(arbitrumSepolia.rpcUrls.default.http[0], {
      batch: true,
      retryCount: 3,
      retryDelay: 1000,
    }),
  },
});
