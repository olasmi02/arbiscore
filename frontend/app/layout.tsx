import type { Metadata } from 'next';
import './globals.css';
import { Web3Provider } from '@/lib/context/Web3Provider';
import { SandboxProvider } from '@/lib/context/SandboxContext';
import { TxProvider } from '@/lib/context/TxContext';
import { WrongNetworkBanner } from '@/components/web3/WrongNetworkBanner';

export const metadata: Metadata = {
  title: 'ArbiScore | Adaptive Undercollateralized DeFi Lending on Arbitrum',
  description:
    'Institutional-grade on-chain credit scoring and adaptive DeFi lending vault powered by Arbitrum Stylus Rust inference engine.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#09090b] text-[#fafafa] antialiased selection:bg-zinc-800 selection:text-white">
        <Web3Provider>
          <TxProvider>
            <SandboxProvider>
            <WrongNetworkBanner />
            {children}
            </SandboxProvider>
          </TxProvider>
        </Web3Provider>
      </body>
    </html>
  );
}
