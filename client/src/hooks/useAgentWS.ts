// FILE: client/src/hooks/useAgentWS.ts
import { useEffect, useRef, useState } from "react";

// ── Inline types (mirrors backend src/types.ts, no cross-boundary import) ──

export type WSEventType =
  | "apyUpdate"
  | "aiDecision"
  | "safetyCheck"
  | "txResult"
  | "agentError"
  | "heartbeat"
  | "positions";

export interface WSMessage<T = unknown> {
  event: WSEventType;
  timestamp: number;
  data: T;
}

export interface PoolInfo {
  id: string;
  protocol: string; // "OneDEX" | "OneVault"
  tier: "established" | "experimental" | "unknown";
  tokenA: string;
  tokenB: string;
  apy: number;      // e.g. 8.5 for 8.5%
  tvlUsd: number;
  fetchedAt: number;
}

export interface AIDecision {
  action: "rebalance" | "hold" | "unknown";
  sourcePoolId: string;
  targetPoolId: string;
  amountPercent: number;
  reasoning: string;
  confidence: number;
  modelUsed: string;
}

export interface SafetyResult {
  approved: boolean;
  reason: string;
}

export interface TxResult {
  digest: string | null;
  dryRun: boolean;
  success: boolean;
  error?: string;
  gasUsed?: string;
}

export interface TxHistoryEntry {
  timestamp: number;
  decision: AIDecision | null;
  tx: TxResult;
}

export interface DecisionHistoryEntry {
  timestamp: number;
  decision: AIDecision;
  safety: SafetyResult | null;  // null until safetyCheck event arrives
  tx: TxResult | null;          // null if hold or safety-blocked
}

export interface Heartbeat {
  runCount: number;
  dryRun: boolean;
  threshold: number;
  isRunning: boolean;
  nextRunIn: string; // e.g. "60s"
}

export interface PositionEntry {
  poolId: string;
  protocol: string;
  tokenA: string;
  tokenB: string;
  allocatedPct: number;
}

// ── Hook ────────────────────────────────────────────────────────────────────

interface UseAgentWSReturn {
  pools: PoolInfo[];
  positions: PositionEntry[];
  lastDecision: AIDecision | null;
  lastTx: TxResult | null;
  txHistory: TxHistoryEntry[];
  decisionHistory: DecisionHistoryEntry[];
  safetyResult: SafetyResult | null;
  wsConnected: boolean;
  heartbeat: Heartbeat | null;
  agentRunning: boolean;         // backend source of truth for agent running state
  wsLatency: number | null;      // ms between server broadcast and client receipt
  lastUpdateAt: number | null;   // Date.now() when last apyUpdate arrived
}

export function useAgentWS(): UseAgentWSReturn {
  const [pools, setPools] = useState<PoolInfo[]>([]);
  const [positions, setPositions] = useState<PositionEntry[]>([]);
  const [lastDecision, setLastDecision] = useState<AIDecision | null>(null);
  const [lastTx, setLastTx] = useState<TxResult | null>(null);
  const [txHistory, setTxHistory] = useState<TxHistoryEntry[]>([]);
  const [decisionHistory, setDecisionHistory] = useState<DecisionHistoryEntry[]>([]);
  const [safetyResult, setSafetyResult] = useState<SafetyResult | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [heartbeat, setHeartbeat] = useState<Heartbeat | null>(null);
  const [agentRunning, setAgentRunning] = useState<boolean>(false); // match backend default
  const [wsLatency, setWsLatency] = useState<number | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);

  const lastDecisionRef = useRef<AIDecision | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // ── Initial fetch for persisted data ──────────────────────────────────────
  useEffect(() => {
    // Fetch configuration
    fetch("/api/agent/config")
      .then(res => res.json())
      .then(data => {
        if (typeof data.isRunning === "boolean") setAgentRunning(data.isRunning);
        setHeartbeat(prev => prev ? { ...prev, ...data } : { runCount: 0, nextRunIn: "60s", ...data });
      })
      .catch(err => console.error("[useAgentWS] Failed to fetch config:", err));

    // Fetch rebalance history from local DB (rich decision data for current session)
    fetch("/api/agent/history")
      .then(res => res.json())
      .then((data: any[]) => {
        const bh: DecisionHistoryEntry[] = data.map(e => ({
          timestamp: e.timestamp,
          decision: e.decision,
          safety: e.safety,
          tx: e.tx,
        }));
        setDecisionHistory(bh.slice(0, 50));
        const th: TxHistoryEntry[] = data
          .filter(e => e.tx)
          .map(e => ({ timestamp: e.timestamp, decision: e.decision, tx: e.tx }));
        setTxHistory(th.slice(0, 50));
      })
      .catch(err => console.error("[useAgentWS] Failed to fetch history:", err));

    // Seed tx history from on-chain data — persists across restarts and rebalances
    fetch("/api/agent/chain-history")
      .then(res => res.json())
      .then((data: any[]) => {
        const chainTxs: TxHistoryEntry[] = data.map(e => ({
          timestamp: e.timestamp,
          decision: null,
          tx: { digest: e.digest, success: e.success, dryRun: false },
        }));
        // Merge with any session history already loaded — deduplicate by digest
        setTxHistory(prev => {
          const seen = new Set(prev.map(e => e.tx.digest).filter(Boolean));
          const fresh = chainTxs.filter(e => !seen.has(e.tx.digest));
          return [...prev, ...fresh].sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);
        });
      })
      .catch(err => console.error("[useAgentWS] Failed to fetch chain history:", err));

    // Fetch APY history (chart data is handled in Dashboard.tsx via its own state,
    // but we could initialize a global chart state here if needed. 
    // For now we'll let Dashboard.tsx handle the 7-day trend fetch if it needs to.)
  }, []);

  useEffect(() => {
    const wsUrl = window.location.origin.replace(/^http/, "ws") + "/ws";

    function connect() {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => setWsConnected(true);

      ws.onclose = () => {
        setWsConnected(false);
        // Reconnect after 3 s
        setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        setWsConnected(false);
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const receivedAt = Date.now();
          const msg = JSON.parse(event.data as string) as WSMessage;

          // Latency = time from server broadcast to client receipt.
          // msg.timestamp is set by the server just before ws.send().
          if (msg.timestamp) {
            setWsLatency(receivedAt - msg.timestamp);
          }

          switch (msg.event) {
            case "apyUpdate": {
              const data = msg.data as PoolInfo[];
              setPools(data);
              setLastUpdateAt(receivedAt);
              break;
            }
            case "aiDecision": {
              const data = msg.data as AIDecision;
              setLastDecision(data);
              lastDecisionRef.current = data;
              // Open a new decision history entry; safety + tx filled in by later events
              setDecisionHistory((prev) => [{
                timestamp: msg.timestamp,
                decision: data,
                safety: null,
                tx: null,
              }, ...prev].slice(0, 10));
              break;
            }
            case "safetyCheck": {
              const data = msg.data as SafetyResult;
              setSafetyResult(data);
              // Patch the most recent decision history entry with the safety result
              setDecisionHistory((prev) => {
                if (prev.length === 0) return prev;
                const [head, ...tail] = prev;
                return [{ ...head, safety: data }, ...tail];
              });
              break;
            }
            case "txResult": {
              const data = msg.data as TxResult;
              setLastTx(data);
              const entry: TxHistoryEntry = {
                timestamp: msg.timestamp,
                decision: lastDecisionRef.current,
                tx: data,
              };
              setTxHistory((prev) => [entry, ...prev].slice(0, 50));
              // Patch the most recent decision history entry with the tx result
              setDecisionHistory((prev) => {
                if (prev.length === 0) return prev;
                const [head, ...tail] = prev;
                return [{ ...head, tx: data }, ...tail];
              });
              break;
            }
            case "positions": {
              setPositions(msg.data as PositionEntry[]);
              break;
            }
            case "heartbeat": {
              const d = msg.data as Record<string, unknown>;
              if (typeof d.runCount === "number") {
                setHeartbeat({
                  runCount: d.runCount as number,
                  dryRun: Boolean(d.dryRun),
                  threshold: Number(d.threshold ?? 1.5),
                  isRunning: Boolean(d.isRunning ?? true),
                  nextRunIn: String(d.nextRunIn ?? "60s"),
                });
              }
              // isRunning is present on every heartbeat, including the welcome message
              if (typeof d.isRunning === "boolean") {
                setAgentRunning(d.isRunning);
              }
              break;
            }
            default:
              break;
          }
        } catch {
          // ignore malformed messages
        }
      };
    }

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, []);

  return { pools, positions, lastDecision, lastTx, txHistory, decisionHistory, safetyResult, wsConnected, heartbeat, agentRunning, wsLatency, lastUpdateAt };
}
