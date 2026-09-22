'use client';

import { useAccount, useSwitchChain } from 'wagmi';
import { arbitrumSepolia } from '@/lib/web3/chains';
import { useEffect, useState } from 'react';

export function useNetworkEnforcer() {
  const { chainId, isConnected } = useAccount();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const [showWrongNetworkBanner, setShowWrongNetworkBanner] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isCorrectChain = chainId === arbitrumSepolia.id;

  useEffect(() => {
    if (mounted && isConnected && !isCorrectChain) {
      setShowWrongNetworkBanner(true);
    } else {
      setShowWrongNetworkBanner(false);
    }
  }, [mounted, isConnected, isCorrectChain, chainId]);

  const handleSwitchToArbitrumSepolia = async () => {
    try {
      await switchChain({ chainId: arbitrumSepolia.id });
    } catch (err: any) {
      console.error('Failed to switch network:', err);
      if (typeof window !== 'undefined' && (window as any).ethereum) {
        try {
          await (window as any).ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: `0x${arbitrumSepolia.id.toString(16)}`,
                chainName: arbitrumSepolia.name,
                nativeCurrency: arbitrumSepolia.nativeCurrency,
                rpcUrls: arbitrumSepolia.rpcUrls.default.http,
                blockExplorerUrls: [arbitrumSepolia.blockExplorers.default.url],
              },
            ],
          });
        } catch (addErr) {
          console.error('Failed to add Arbitrum Sepolia chain:', addErr);
        }
      }
    }
  };

  return {
    mounted,
    isConnected,
    isCorrectChain,
    currentChainId: chainId,
    targetChain: arbitrumSepolia,
    showWrongNetworkBanner,
    isSwitching,
    handleSwitchToArbitrumSepolia,
  };
}
