// FILE: client/src/hooks/useOneWallet.ts
// Wraps @onelabs/dapp-kit's wallet hooks with a clean API for OneNomad.
// Provides wallet connection state, address, and connect/disconnect helpers.

import {
  useCurrentAccount,
  useSuiClientQuery,
  useConnectWallet,
  useDisconnectWallet,
  useWallets,
} from "@onelabs/dapp-kit";

export function useOneWallet() {
  const currentAccount = useCurrentAccount();
  const address = currentAccount?.address ?? null;
  const { data: coins } = useSuiClientQuery('getCoins', { owner: address as string }, { enabled: !!address });
  const { mutate: connectWallet } = useConnectWallet();
  const { mutate: disconnectWallet } = useDisconnectWallet();
  const wallets = useWallets();

  const isConnected = !!currentAccount;
  const balance = coins?.data
    ? (Number(coins.data.reduce((acc: bigint, coin: any) => acc + BigInt(coin.balance), 0n)) / 1_000_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";

  const connect = () => {
    // Strict match for OneWallet — never fall back to other wallets (e.g. Phantom)
    const oneWallet = wallets.find(w => {
      const name = w.name.toLowerCase().replace(/\s+/g, "");
      const id   = (w.id ?? "").toLowerCase();
      return (
        name === "onewallet" ||
        name === "one"       ||
        id.includes("onelabs")   ||
        id.includes("onechain")  ||
        id.includes("onewallet")
      );
    });

    if (oneWallet) {
      connectWallet({ wallet: oneWallet });
    } else {
      // Log what was detected so the developer can check the exact name
      console.warn(
        "[OneNomad] OneWallet not detected.\nInstalled wallets found:",
        wallets.map(w => `"${w.name}" (id: ${w.id ?? "n/a"})`).join(", ") || "none"
      );
    }
  };

  const disconnect = () => {
    disconnectWallet();
  };

  return { isConnected, address, balance, connect, disconnect, wallets };
}
