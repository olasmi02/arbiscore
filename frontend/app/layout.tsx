import type { Metadata } from 'next';
import './globals.css';
import { Web3Provider } from '@/lib/context/Web3Provider';
import { SandboxProvider } from '@/lib/context/SandboxContext';
import { TxProvider } from '@/lib/context/TxContext';
import { MarketProvider } from '@/lib/context/MarketContext';
import { WrongNetworkBanner } from '@/components/web3/WrongNetworkBanner';

export const metadata: Metadata = {
  title: 'ArbiScore | On-chain credit that lowers your collateral',
  description:
    'Repayment history scored on-chain by a Rust model on Arbitrum Stylus. Proven borrowers post as little as 105% collateral in the Paxos USDG and test USDC markets.',
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
            <MarketProvider>
              <SandboxProvider>
                <WrongNetworkBanner />
                {children}
              </SandboxProvider>
            </MarketProvider>
          </TxProvider>
        </Web3Provider>
      </body>
    </html>
  );
}
