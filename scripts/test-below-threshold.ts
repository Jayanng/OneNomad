// FILE: scripts/test-below-threshold.ts
// Injects a rebalance decision with +1.0% net gain (below the 1.5% floor)
// and traces exactly where in the agent pipeline it gets stopped.
// Run: npx ts-node scripts/test-below-threshold.ts

import "dotenv/config";
import { validateDecision } from "../src/safety";
import type { AIDecision, PoolInfo } from "../src/types";

const GREEN  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const RED    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const CYAN   = (s: string) => `\x1b[36m${s}\x1b[0m`;
const DIM    = (s: string) => `\x1b[2m${s}\x1b[0m`;
const BOLD   = (s: string) => `\x1b[1m${s}\x1b[0m`;

// ── Pool snapshot ─────────────────────────────────────────────
// Two established pools — source at 12%, target at 13%.
// Net gain = +1.0%, below the 1.5% minimum.

const POOL_SOURCE: PoolInfo = {
  id: "pool-oct-usdc",
  protocol: "OneDEX",
  tier: "established",
  tokenA: "OCT", tokenB: "USDC",
  apy: 12.0, tvlUsd: 2_100_000, fetchedAt: Date.now(),
};

const POOL_TARGET: PoolInfo = {
  id: "pool-oct-usdt",
  protocol: "OneDEX",
  tier: "established",
  tokenA: "OCT", tokenB: "USDT",
  apy: 13.0, tvlUsd: 1_800_000, fetchedAt: Date.now(),
};

const POOLS: PoolInfo[] = [POOL_SOURCE, POOL_TARGET];

// ── Simulated AI decision ─────────────────────────────────────
// The AI said "rebalance" — it detected +1.0% but didn't apply the threshold rule.
// The safety gate is the last line of defence.

const AI_DECISION: AIDecision = {
  action: "rebalance",
  sourcePoolId: POOL_SOURCE.id,
  targetPoolId: POOL_TARGET.id,
  amountPercent: 50,
  reasoning: "OCT/USDT offers 13% vs 12% in OCT/USDC — moving 50% of position.",
  confidence: 0.71,
  modelUsed: "llama-3.3-70b-versatile",
};

const netGain = POOL_TARGET.apy - POOL_SOURCE.apy;

// ── Pipeline trace ────────────────────────────────────────────

console.log(`\n${BOLD("══════════════════════════════════════════════════════════════")}`);
console.log(`${BOLD("  Below-Threshold Rebalance — Full Pipeline Trace")}`);
console.log(`${BOLD("══════════════════════════════════════════════════════════════")}`);

// Step 1 — APY snapshot
console.log(`\n${BOLD("[ 1 ] APY Snapshot")}`);
console.log(`  Source : ${POOL_SOURCE.protocol} ${POOL_SOURCE.tokenA}/${POOL_SOURCE.tokenB}  ${YELLOW(POOL_SOURCE.apy + "% APY")}`);
console.log(`  Target : ${POOL_TARGET.protocol} ${POOL_TARGET.tokenA}/${POOL_TARGET.tokenB}  ${YELLOW(POOL_TARGET.apy + "% APY")}`);
console.log(`  Net gain available : ${CYAN("+" + netGain.toFixed(1) + "%")}`);
console.log(`  Minimum threshold  : ${CYAN("1.5%")}`);
console.log(`  Gap to threshold   : ${RED((netGain - 1.5).toFixed(1) + "%  ← below floor")}`);

// Step 2 — AI decision
console.log(`\n${BOLD("[ 2 ] AI Decision  (simulated — model would say rebalance)")}`);
console.log(`  action         : ${RED(BOLD("rebalance"))}  ← AI did NOT apply the threshold rule itself`);
console.log(`  sourcePoolId   : ${DIM(AI_DECISION.sourcePoolId)}`);
console.log(`  targetPoolId   : ${DIM(AI_DECISION.targetPoolId)}`);
console.log(`  amountPercent  : ${AI_DECISION.amountPercent}%`);
console.log(`  confidence     : ${(AI_DECISION.confidence * 100).toFixed(0)}%`);
console.log(`  reasoning      : ${DIM(AI_DECISION.reasoning)}`);

// Step 3 — Safety gate
console.log(`\n${BOLD("[ 3 ] Safety Gate  (validateDecision)")}`);
const safety = validateDecision(AI_DECISION, POOLS);
const gateLabel = safety.approved ? GREEN(BOLD("APPROVED")) : RED(BOLD("BLOCKED "));
console.log(`  Result  : ${gateLabel}`);
console.log(`  Reason  : ${DIM(safety.reason)}`);

// Step 4 — Agent decision point
console.log(`\n${BOLD("[ 4 ] Agent Execution Step")}`);
if (!safety.approved) {
  console.log(`  ${RED("✗")} Safety gate rejected the decision.`);
  console.log(`  ${YELLOW("→")} Agent calls ${BOLD("return")} — PTB is never built.`);
  console.log(`  ${YELLOW("→")} No ${BOLD("executeRebalance()")} call.`);
  console.log(`  ${YELLOW("→")} No ${BOLD("signAndExecuteTransaction()")} call.`);
  console.log(`  ${YELLOW("→")} Funds stay in OCT/USDC pool at 12% APY.`);
  console.log(`  ${YELLOW("→")} Agent continues cron loop — will check again next cycle.`);
} else {
  console.log(`  ${GREEN("✓")} Safety gate approved — PTB would execute.`);
}

// Step 5 — What would need to change
console.log(`\n${BOLD("[ 5 ] What Would Unlock the Rebalance")}`);
console.log(`  Current target APY   : ${POOL_TARGET.apy}%`);
console.log(`  Required target APY  : ${CYAN("≥ " + (POOL_SOURCE.apy + 1.5).toFixed(1) + "%")}  (source + 1.5% floor)`);
console.log(`  Gap to unlock        : ${CYAN("+" + (POOL_SOURCE.apy + 1.5 - POOL_TARGET.apy).toFixed(1) + "% more APY on the target pool")}`);

// Verdict
console.log(`\n${BOLD("══════════════════════════════════════════════════════════════")}`);
if (!safety.approved) {
  console.log(RED(BOLD("  ✗ REBALANCE SKIPPED — net gain 1.0% is below the 1.5% floor")));
  console.log(RED(`    PTB never built · no gas spent · funds untouched`));
  console.log(DIM(`    Safety gate reason: "${safety.reason}"`));
} else {
  console.log(RED(BOLD("  Test failed — safety gate should have blocked this")));
  process.exit(1);
}
console.log(BOLD("══════════════════════════════════════════════════════════════\n"));
