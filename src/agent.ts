import * as cron from "node-cron";
import { SuiClient, getFullnodeUrl } from "@onelabs/sui/client";
import { Ed25519Keypair } from "@onelabs/sui/keypairs/ed25519";
import { fetchAPYs } from "./apyFetcher";
import { getAIDecision } from "./aiDecision";
import { validateDecision } from "./safety";
import { executeRebalance } from "./txBuilder";
import { EventMonitor } from "./eventMonitor";
import { db } from "./db";
import type { AgentRunSummary, AIDecision, PoolInfo, PositionEntry, WSMessage } from "./types";

// ── Position tracking ─────────────────────────────────────────────────────────
const globalAgentPositions = new Map<string, number>(); // poolId -> allocatedPct
const POSITION_OBJ_ID = process.env.POSITION_OBJECT_ID!;

// ── Config ────────────────────────────────────────────────────────────────────
const initialConfig   = db.getConfig();
const RPC_URL          = process.env.ONECHAIN_RPC_URL ?? getFullnodeUrl("testnet");
let DRY_RUN             = initialConfig.dryRun ?? (process.env.DRY_RUN === "true"); // default false — env var controls
let AGENT_THRESHOLD    = initialConfig.threshold ?? 1.5;
const CRON_SECS        = parseInt(process.env.CRON_INTERVAL_SEC ?? "60", 10);
const CRON_EXPR        = `*/${CRON_SECS} * * * * *`; // every N seconds
const GAS_BUDGET_MIST  = parseInt(process.env.GAS_BUDGET_MIST ?? "10000000", 10); // 0.01 OCT per tx
const MIN_GAS_BALANCE  = GAS_BUDGET_MIST * 5;         // 0.05 OCT — must cover at least 5 cycles

// ── Gas balance guard ─────────────────────────────────────────────────────────

/**
 * Returns the wallet's current native balance in MIST, or null if unreachable.
 */
async function getWalletBalance(): Promise<bigint | null> {
  try {
    const key = process.env.PRIVATE_KEY;
    if (!key) return null;
    const keypair = Ed25519Keypair.fromSecretKey(key);
    const address = keypair.toSuiAddress();
    const result  = await client.getBalance({ owner: address });
    return BigInt(result.totalBalance);
  } catch {
    return null;
  }
}

/**
 * Returns true if the wallet has enough gas to safely execute a PTB.
 * Logs a warning and broadcasts a lowBalance event when funds are tight.
 */
async function hasSufficientGas(): Promise<boolean> {
  const balance = await getWalletBalance();

  if (balance === null) {
    console.warn(`[agent] ⚠ Could not fetch wallet balance — proceeding cautiously.`);
    return true; // don't block on RPC failure
  }

  const balanceOct  = (Number(balance) / 1e9).toFixed(6);
  const minOct      = (MIN_GAS_BALANCE  / 1e9).toFixed(6);

  if (balance < BigInt(MIN_GAS_BALANCE)) {
    console.warn(`[agent] ✗ LOW BALANCE — ${balanceOct} OCT available, minimum is ${minOct} OCT`);
    console.warn(`[agent] ✗ Skipping rebalance to protect remaining gas. Top up wallet and restart.`);
    broadcast({
      event: "agentError",
      timestamp: Date.now(),
      data: {
        type: "lowBalance",
        balanceMist: balance.toString(),
        balanceOct,
        minimumOct: minOct,
        message: `Wallet balance ${balanceOct} OCT is below the ${minOct} OCT safety floor. Rebalance skipped.`,
      },
    });
    return false;
  }

  console.log(`[agent] Gas balance OK — ${balanceOct} OCT (min: ${minOct} OCT)`);
  return true;
}

// ── Broadcast hook (injected by dashboard.ts) ─────────────────────────────────

type BroadcastFn = (msg: WSMessage) => void;
let broadcast: BroadcastFn = () => {}; // no-op until dashboard injects it

export function setBroadcast(fn: BroadcastFn): void {
  broadcast = fn;
}

// ── OneChain client (shared across runs) ──────────────────────────────────────────

const client = new SuiClient({ url: RPC_URL });
const monitor = new EventMonitor(client);

// ── Agent running state ───────────────────────────────────────────────────────

let agentRunning = initialConfig.isRunning ?? true; // default true — auto-start on fresh deploy
let isCycleRunning = false; // concurrency guard
let cronTask: cron.ScheduledTask | null = null;

export function isAgentRunning(): boolean {
  return agentRunning;
}

export function pauseAgent(): void {
  if (!agentRunning) return;
  agentRunning = false;
  db.saveConfig({ isRunning: false });
  cronTask?.stop();
  console.log("[agent] Agent paused.");
  broadcastHeartbeat();
}

export function resumeAgent(): void {
  if (agentRunning) return;
  agentRunning = true;
  db.saveConfig({ isRunning: true });
  cronTask?.start();
  console.log("[agent] Agent resumed.");
  broadcastHeartbeat();
  // Don't trigger a cycle if one is already running (e.g. from manual trigger)
  if (!isCycleRunning) void runAgentCycle();
}

export function setDryRun(val: boolean): void {
  const changed = DRY_RUN !== val;
  DRY_RUN = val;
  if (changed) {
    db.saveConfig({ dryRun: val });
    console.log(`[agent] Dry run mode set to: ${DRY_RUN}`);
    broadcastHeartbeat();
  }
}

export function isDryRun(): boolean {
  return DRY_RUN;
}

export function setThreshold(val: number): void {
  AGENT_THRESHOLD = val;
  db.saveConfig({ threshold: val });
  console.log(`[agent] Threshold set to: ${AGENT_THRESHOLD}%`);
  broadcastHeartbeat();
}

export function getThreshold(): number {
  return AGENT_THRESHOLD;
}

// ── Run counter ───────────────────────────────────────────────────────────────

let runCounter = 0;

// ── Position tracking ─────────────────────────────────────────────────────────
// Tracks the agent's allocation across pools as percentages (sum = 100).
// Initialised by syncing from chain or equal-weight fallback.

async function syncPositionsFromChain(pools: PoolInfo[]): Promise<boolean> {
  try {
    const obj = await client.getObject({ id: POSITION_OBJ_ID, options: { showContent: true } });
    if (obj.data?.content?.dataType !== "moveObject") return false;

    const fields = (obj.data.content as any).fields;
    const entries = (fields.deposits?.fields?.contents as any[]) ?? [];

    if (entries.length === 0) {
      // Valid state: object exists but no deposits yet. Return true to signal success with 0 balances.
      console.log(`[agent] ✓ Position object '${POSITION_OBJ_ID.slice(0, 8)}…' found, but it has no active deposits.`);
      for (const pool of pools) globalAgentPositions.set(pool.id, 0);
      return true;
    }

    const balances = new Map<string, bigint>();
    let totalBalance = 0n;

    for (const entry of entries) {
      const e = entry.fields || entry;
      const pid = e.key;
      const bal = BigInt(e.value);
      balances.set(pid, bal);
      totalBalance += bal;
    }

    if (totalBalance === 0n) {
      for (const pool of pools) globalAgentPositions.set(pool.id, 0);
      return true;
    }

    for (const pool of pools) {
      const bal = balances.get(pool.id) ?? 0n;
      const pct = parseFloat(((Number(bal) / Number(totalBalance)) * 100).toFixed(1));
      globalAgentPositions.set(pool.id, pct);
    }

    console.log(`[agent] ✓ Synchronised positions from chain. Total: ${totalBalance} tokens across ${globalAgentPositions.size} tracked pools.`);
    return true;
  } catch (err) {
    console.warn(`[agent] ⚠ Failed to sync positions from chain:`, String(err).slice(0, 80));
    return false;
  }
}

async function initPositions(pools: PoolInfo[]): Promise<void> {
  // Check if we already have real (non-zero) positions — skip re-sync only then
  const hasRealPositions = [...globalAgentPositions.values()].some(v => v > 0);
  if (hasRealPositions) {
    for (const pool of pools) {
      if (!globalAgentPositions.has(pool.id)) globalAgentPositions.set(pool.id, 0);
    }
    return;
  }

  // Always attempt chain sync if no real positions yet (retries on every cycle until successful)
  const synced = await syncPositionsFromChain(pools);
  if (synced) return;

  // Fallback to 0 — will retry next cycle
  console.warn(`[agent] ⚠ Could not synchronise with on-chain Position object — will retry next cycle.`);
  for (const pool of pools) globalAgentPositions.set(pool.id, 0);
}

function applyRebalanceToPositions(decision: AIDecision): void {
  if (decision.action !== "rebalance") return;
  const srcPct = globalAgentPositions.get(decision.sourcePoolId) ?? 0;
  const moved  = parseFloat((srcPct * decision.amountPercent / 100).toFixed(2));
  globalAgentPositions.set(decision.sourcePoolId, Math.max(0, srcPct - moved));
  globalAgentPositions.set(decision.targetPoolId, (globalAgentPositions.get(decision.targetPoolId) ?? 0) + moved);
}

function getCurrentPositions(pools: PoolInfo[]): PositionEntry[] {
  return pools
    .map(p => ({
      poolId:       p.id,
      protocol:     p.protocol,
      tokenA:       p.tokenA,
      tokenB:       p.tokenB,
      allocatedPct: parseFloat((globalAgentPositions.get(p.id) ?? 0).toFixed(1)),
    }))
    .filter(e => e.allocatedPct > 0);
}

function broadcastPositions(pools: PoolInfo[]): void {
  const entries = getCurrentPositions(pools);
  broadcast({ event: "positions", timestamp: Date.now(), data: entries });
}

// ── Single agent run ──────────────────────────────────────────────────────────

/**
 * One full agent cycle:
 *   fetch APYs → AI decision → safety gate → execute PTB → broadcast results
 */
async function runAgentCycle(): Promise<void> {
  if (isCycleRunning) {
    console.warn(`[agent] A cycle is already in progress. Skipping concurrent run.`);
    return;
  }
  isCycleRunning = true;
  runCounter++;
  const runId  = `run-${runCounter}-${Date.now()}`;
  const startedAt = Date.now();

  const summary: AgentRunSummary = {
    runId,
    startedAt,
    pools: [],
    decision: null,
    safetyResult: null,
    txResult: null,
  };

  try {
    // ── 1. Fetch APYs ───────────────────────────────────────────────────────
    console.log(`\n[agent] ── Run ${runCounter} ──────────────────────────────`);
    console.log(`[agent] Fetching APYs...`);

    const pools = await fetchAPYs(client);
    if (pools.length === 0) {
      console.warn(`[agent] ⚠ No pools fetched. Skipping this cycle.`);
      return;
    }
    summary.pools = pools;

    await initPositions(pools);

    broadcast({
      event: "apyUpdate",
      timestamp: Date.now(),
      data: pools,
    });
    db.addApyEntry(pools);

    broadcastPositions(pools);

    console.log(`[agent] ${pools.length} pools fetched. Best APY: ${Math.max(...pools.map(p => p.apy)).toFixed(2)}%`);

    // ── 2. AI Decision ──────────────────────────────────────────────────────
    console.log(`[agent] Requesting AI decision...`);

    const currentPositions = getCurrentPositions(pools);
    console.log(`[agent] Current positions: ${JSON.stringify(currentPositions)}`);
    const decision = await getAIDecision(pools, currentPositions, AGENT_THRESHOLD);
    summary.decision = decision;

    broadcast({
      event: "aiDecision",
      timestamp: Date.now(),
      data: decision,
    });

    console.log(`[agent] AI decision: ${decision.action} | model: ${decision.modelUsed} | confidence: ${decision.confidence}`);
    if (decision.action === "rebalance") {
      console.log(`[agent] Rebalance: ${decision.sourcePoolId} → ${decision.targetPoolId} (${decision.amountPercent}%)`);
    }

    // ── 3. Safety Gate ──────────────────────────────────────────────────────
    const safetyResult = validateDecision(decision, pools, AGENT_THRESHOLD);
    summary.safetyResult = safetyResult;

    broadcast({
      event: "safetyCheck",
      timestamp: Date.now(),
      data: safetyResult,
    });

    console.log(`[agent] Safety: ${safetyResult.approved ? "APPROVED" : "REJECTED"} — ${safetyResult.reason}`);

    if (!safetyResult.approved) {
      console.log(`[agent] Rebalance blocked by safety gate. Holding.`);
      return;
    }

    // ── 4. Execute (or skip if hold) ────────────────────────────────────────
    if (decision.action !== "rebalance") {
      console.log(`[agent] Action is '${decision.action}' — no transaction needed.`);
      return;
    }

    // ── 4a. Pre-flight: check wallet has enough gas ──────────────────────────
    // Skip this check in dry-run mode — no gas is spent on simulations.
    if (!DRY_RUN) {
      const enoughGas = await hasSufficientGas();
      if (!enoughGas) {
        console.warn(`[agent] Rebalance halted — insufficient gas balance.`);
        return;
      }
    }

    console.log(`[agent] ${DRY_RUN ? "[DRY RUN]" : "[LIVE]"} Executing rebalance PTB...`);

    const txResult = await executeRebalance(client, decision, pools, DRY_RUN);
    summary.txResult = txResult;

    broadcast({
      event: "txResult",
      timestamp: Date.now(),
      data: txResult,
    });

    if (txResult.success) {
      console.log(`[agent] ✓ PTB ${DRY_RUN ? "simulated" : "executed"} successfully.`);
      if (txResult.digest) {
        const explorerUrl = `https://onescan.cc/testnet/tx/${txResult.digest}`;
        console.log(`[agent] ┌─────────────────────────────────────────────────────────`);
        console.log(`[agent] │  Transaction confirmed on OneChain testnet`);
        console.log(`[agent] │  Digest  : ${txResult.digest}`);
        console.log(`[agent] │  Explorer: ${explorerUrl}`);
        if (txResult.gasUsed) {
          console.log(`[agent] │  Gas     : ${txResult.gasUsed}`);
        }
        console.log(`[agent] └─────────────────────────────────────────────────────────`);
        // Re-sync positions from chain now that the tx is confirmed — keeps
        // in-memory state consistent with on-chain reality so the next PTB
        // uses the correct version of the Position object.
        await syncPositionsFromChain(pools);
        broadcastPositions(pools);
        // Verify on-chain events
        const events = await monitor.getTransactionEvents(txResult.digest);
        events.forEach(ev => {
          const formatted = monitor.formatEvent(ev);
          console.log(`[agent] ${formatted}`);
          broadcast({
            event: "txResult",
            timestamp: Date.now(),
            data: formatted,
          });
        });
      } else {
        // Dry-run — no digest; use in-memory math (no chain state changed)
        applyRebalanceToPositions(decision);
        broadcastPositions(pools);
        console.log(`[agent] ✓ Dry-run simulation complete — no digest (funds not moved).`);
        if (txResult.gasUsed) console.log(`[agent] Gas (simulated): ${txResult.gasUsed}`);
      }
    } else {
      console.error(`[agent] ✗ PTB failed: ${txResult.error}`);
      // Clear in-memory positions so the next cycle re-syncs from chain.
      // Prevents stale allocations (wrong source pool / old object version).
      globalAgentPositions.clear();
      console.warn(`[agent] Position cache cleared after PTB failure — next cycle will re-sync from chain.`);
    }

    // Persist rebalance history for dashboard access
    db.addHistoryEntry({ decision, safety: safetyResult, tx: txResult });

  } catch (err) {
    const errMsg = String(err);
    summary.error = errMsg;
    console.error(`[agent] Unhandled error in cycle:`, errMsg);

    broadcast({
      event: "agentError",
      timestamp: Date.now(),
      data: { runId, error: errMsg },
    });
    // Still record the run attempt
    db.addHistoryEntry({ summary: { ...summary, error: errMsg } });
  } finally {
    isCycleRunning = false;
  }
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

function broadcastHeartbeat(): void {
  broadcast({
    event: "heartbeat",
    timestamp: Date.now(),
    data: {
      runCount: runCounter,
      dryRun: DRY_RUN,
      threshold: AGENT_THRESHOLD,
      isRunning: agentRunning,
      nextRunIn: `${CRON_SECS}s`,
    },
  });
}

function startHeartbeat(): void {
  setInterval(broadcastHeartbeat, 10_000); // every 10 seconds
}

// ── Start ─────────────────────────────────────────────────────────────────────

/**
 * Trigger a single agent cycle immediately (called by POST /api/trigger).
 */
export function triggerAgentCycle(): void {
  void runAgentCycle();
}

/**
 * Clears the in-memory position cache so the next cycle re-syncs from chain.
 * Equivalent to a restart — safe to call at any time.
 */
export function resetPositions(): void {
  globalAgentPositions.clear();
  console.log("[agent] Position cache cleared — next cycle will re-sync from chain.");
}

/**
 * Start the cron-based agent loop.
 * Called once by dashboard.ts on server boot.
 */
export function startAgent(): void {
  const groqKey    = process.env.GROQ_API_KEY;
  const mistralKey = process.env.MISTRAL_API_KEY;

  console.log(`[agent] Starting OneNomad agent`);
  console.log(`[agent] RPC:      ${RPC_URL}`);
  console.log(`[agent] Mode:     ${DRY_RUN ? "DRY RUN (simulation)" : "LIVE (real transactions)"}`);
  console.log(`[agent] Interval: every ${CRON_SECS}s`);
  console.log(`[agent] Groq key:    ${groqKey    ? `present (${groqKey.slice(0, 6)}…${groqKey.slice(-4)})`    : "MISSING — Groq will be skipped"}`);
  console.log(`[agent] Mistral key: ${mistralKey ? `present (${mistralKey.slice(0, 6)}…${mistralKey.slice(-4)})` : "MISSING — Mistral will be skipped"}`);
  if (!groqKey && !mistralKey) {
    console.warn(`[agent] WARNING: No AI keys set — every cycle will safe-hold`);
  }

  // Do NOT fire once immediately on boot — ONLY when toggled
  // void runAgentCycle();

  // Then on cron schedule — store task so pauseAgent/resumeAgent can control it
  cronTask = cron.schedule(CRON_EXPR, () => {
    if (agentRunning) void runAgentCycle();
  });

  startHeartbeat();
  console.log(`[agent] Agent loop running. Cron: ${CRON_EXPR}`);
}
