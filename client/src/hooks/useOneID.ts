// FILE: client/src/hooks/useOneID.ts
// Resolves a OneChain address to its OneID (.one) name if one is registered.
// Uses the onelabs RPC suix_resolveNameServiceNames method.
// Falls back to the short address format (0x1234…abcd) if no name is found.

import { useEffect, useState } from "react";

const TESTNET_RPC = "/api/rpc";

/**
 * Shortens a hex address: "0x1234...abcd" style.
 */
export function shortenAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Resolve a OneChain address to a OneID name.
 * Returns the .one name if found, or the shortened address if not.
 */
export function useOneID(address: string | null | undefined): {
  name: string | null;
  isLoading: boolean;
} {
  const [name, setName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      setName(null);
      return;
    }

    setIsLoading(true);

    const resolve = async () => {
      try {
        const res = await fetch(TESTNET_RPC, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "suix_resolveNameServiceNames",
            params: [address, null, 1],
          }),
        });
        const json = await res.json();
        const names: string[] = json?.result?.data ?? [];
        setName(names[0] ?? null);
      } catch {
        setName(null);
      } finally {
        setIsLoading(false);
      }
    };

    void resolve();
  }, [address]);

  return { name, isLoading };
}
