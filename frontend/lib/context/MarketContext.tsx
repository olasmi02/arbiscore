'use client';

import React, { createContext, useContext, useState } from 'react';
import { AVAILABLE_MARKETS, MARKETS, type MarketConfig, type MarketId } from '@/lib/web3/addresses';

interface MarketContextType {
  market: MarketConfig;
  markets: MarketConfig[];
  setMarketId: (id: MarketId) => void;
}

const MarketContext = createContext<MarketContextType | undefined>(undefined);

/** Which lending market (Paxos USDG or test USDC) the dashboard is acting on. */
export function MarketProvider({ children }: { children: React.ReactNode }) {
  const [marketId, setMarketId] = useState<MarketId>('USDG');
  const market = MARKETS[marketId].vault ? MARKETS[marketId] : AVAILABLE_MARKETS[0];
  return (
    <MarketContext.Provider value={{ market, markets: AVAILABLE_MARKETS, setMarketId }}>{children}</MarketContext.Provider>
  );
}

export function useMarket() {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error('useMarket must be used within a MarketProvider');
  return ctx;
}
