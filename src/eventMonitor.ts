// FILE: src/eventMonitor.ts
import { SuiClient, SuiEvent } from "@onelabs/sui/client";

/**
 * EventMonitor provides utilities for tracking on-chain events emitted by
 * OneDEX and OneVault contracts on OneChain.
 */
export class EventMonitor {
  constructor(private client: SuiClient) {}

  /**
   * Waits for a transaction to be indexed and returns its events.
   * Useful for confirming the specific impact of an agent rebalance.
   */
  async getTransactionEvents(digest: string, timeoutMs = 20000): Promise<SuiEvent[]> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const tx = await this.client.getTransactionBlock({
          digest,
          options: { showEvents: true },
        });
        if (tx.events) return tx.events;
      } catch (err) {
        // Transaction might not be indexed yet
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return [];
  }

  /**
   * Queries for recent events from a specific package (e.g., OneDEX).
   * Used to populate the "Recent Activity" logs with verified on-chain data.
   */
  async queryRecentEvents(packageId: string, limit = 10): Promise<SuiEvent[]> {
    if (!packageId || packageId === "0x0") return [];
    
    try {
      const result = await this.client.queryEvents({
        query: { MoveModule: { package: packageId, module: "pool" } },
        limit,
        order: "descending",
      });
      return result.data;
    } catch (err) {
      console.error(`[eventMonitor] Failed to query events for ${packageId}:`, err);
      return [];
    }
  }

  /**
   * Formats a raw OneChain event into a human-readable message for the dashboard.
   */
  formatEvent(event: SuiEvent): string {
    const type = event.type;
    if (type.includes("SwapEvent")) {
      return `[SUCCESS] Verified Swap: ${(event.parsedJson as any).amount_in} -> ${(event.parsedJson as any).amount_out}`;
    }
    if (type.includes("DepositEvent")) {
      return `[SUCCESS] Verified Deposit: ${(event.parsedJson as any).amount} tokens added to pool.`;
    }
    return `[INFO] Verified event: ${type.split("::").pop()}`;
  }
}
