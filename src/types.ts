// ── Pool / Strategy data ──────────────────────────────────────────────────────

export type ProtocolTier = "established" | "experimental" | "unknown";

export interface PoolInfo {
  id: string;           // on-chain object id
  protocol: string;     // e.g. "OneDEX" | "OneVault"
  tier: ProtocolTier;
  tokenA: string;       // coin type, e.g. "0x2::one::OCT"
  tokenB: string;
  apy: number;          // annualised percentage (e.g. 8.5 for 8.5%)
  tvlUsd: number;
  fetchedAt: number;    // unix ms
}

// ── AI decision ───────────────────────────────────────────────────────────────

export type ActionType = "rebalance" | "hold" | "unknown";

export interface AIDecision {
  action: ActionType;
  sourcePoolId: string;
  targetPoolId: string;
  amountPercent: number;  // 0-100 — percentage of position to move
  reasoning: string;
  confidence: number;     // 0-1
  modelUsed: string;      // which model produced this decision
}

// ── Safety result ─────────────────────────────────────────────────────────────

export interface SafetyResult {
  approved: boolean;
  reason: string;
}

// ── Transaction result ────────────────────────────────────────────────────────

export interface TxResult {
  digest: string | null;  // null on dry-run
  dryRun: boolean;
  success: boolean;
  error?: string;
  gasUsed?: string;
}

// ── Agent positions ───────────────────────────────────────────────────────────

export interface PositionEntry {
  poolId: string;
  protocol: string;
  tokenA: string;
  tokenB: string;
  allocatedPct: number;  // 0-100, share of agent's total managed capital
}

// ── WebSocket broadcast envelope ──────────────────────────────────────────────

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

// ── Agent run summary ─────────────────────────────────────────────────────────

export interface AgentRunSummary {
  runId: string;
  startedAt: number;
  pools: PoolInfo[];
  decision: AIDecision | null;
  safetyResult: SafetyResult | null;
  txResult: TxResult | null;
  error?: string;
}
