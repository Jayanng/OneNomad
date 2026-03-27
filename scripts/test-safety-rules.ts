// FILE: scripts/test-safety-rules.ts
// Deliberately trips every safety rule in safety.ts and asserts it was blocked.
// Run: npx ts-node scripts/test-safety-rules.ts

import "dotenv/config";
import { validateDecision } from "../src/safety";
import type { AIDecision, PoolInfo } from "../src/types";

// ── Colours ───────────────────────────────────────────────────
const GREEN  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const RED    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const CYAN   = (s: string) => `\x1b[36m${s}\x1b[0m`;
const DIM    = (s: string) => `\x1b[2m${s}\x1b[0m`;
const BOLD   = (s: string) => `\x1b[1m${s}\x1b[0m`;

// ── Baseline pool set ─────────────────────────────────────────
// Two clean "established" pools — used as the safe baseline.
const POOL_A: PoolInfo = {
  id: "pool-A",
  protocol: "OneDEX",
  tier: "established",
  tokenA: "OCT", tokenB: "USDC",
  apy: 8.0, tvlUsd: 2_000_000, fetchedAt: Date.now(),
};

const POOL_B: PoolInfo = {
  id: "pool-B",
  protocol: "OneDEX",
  tier: "established",
  tokenA: "OCT", tokenB: "USDT",
  apy: 18.0, tvlUsd: 1_800_000, fetchedAt: Date.now(),
};

// ── Baseline VALID decision (should pass) ────────────────────
const BASE_DECISION: AIDecision = {
  action: "rebalance",
  sourcePoolId: "pool-A",
  targetPoolId: "pool-B",
  amountPercent: 50,
  reasoning: "10% net gain — clear move.",
  confidence: 0.92,
  modelUsed: "test",
};

// ── Test runner ───────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(
  label: string,
  rule: string,
  decision: AIDecision,
  pools: PoolInfo[],
  expectApproved: boolean
): void {
  const result = validateDecision(decision, pools);
  const ok = result.approved === expectApproved;

  if (ok) passed++;
  else failed++;

  const tick   = ok ? GREEN("✓ PASS") : RED("✗ FAIL");
  const status = result.approved ? GREEN("APPROVED") : RED("BLOCKED ");

  console.log(`\n  ${tick}  ${BOLD(label)}`);
  console.log(`         Rule      : ${CYAN(rule)}`);
  console.log(`         Outcome   : ${status}`);
  console.log(`         Reason    : ${DIM(result.reason)}`);

  if (!ok) {
    console.log(`         ${RED("Expected")} : ${expectApproved ? "APPROVED" : "BLOCKED"} — test logic error`);
  }
}

// ── Main ──────────────────────────────────────────────────────

console.log(`\n${BOLD("══════════════════════════════════════════════════════════════")}`);
console.log(`${BOLD("  OneNomad Safety Gate — Deliberate Rule Triggers")}`);
console.log(`${BOLD("══════════════════════════════════════════════════════════════")}`);
console.log(`  Each test crafts a specific violation and asserts the gate blocks it.`);
console.log(`  A ${GREEN("✓ PASS")} means the gate fired correctly.\n`);

// ─────────────────────────────────────────────────────────────
// BASELINE — must approve a clean decision first
// ─────────────────────────────────────────────────────────────
console.log(BOLD("[ 0 ] Baseline — valid decision must be APPROVED"));
test(
  "Clean 10% gain, both established pools",
  "n/a — all rules satisfied",
  BASE_DECISION,
  [POOL_A, POOL_B],
  true  // expect: approved
);

// ─────────────────────────────────────────────────────────────
// RULE 1 — Source pool not in current APY data
// ─────────────────────────────────────────────────────────────
console.log(`\n${BOLD("[ 1 ] Source pool not in current APY snapshot")}`);
test(
  "sourcePoolId points to a stale / unknown pool",
  "source pool must exist in current APY data",
  { ...BASE_DECISION, sourcePoolId: "pool-UNKNOWN" },
  [POOL_A, POOL_B],
  false  // expect: blocked
);

// ─────────────────────────────────────────────────────────────
// RULE 2 — Target pool not in current APY data
// ─────────────────────────────────────────────────────────────
console.log(`\n${BOLD("[ 2 ] Target pool not in current APY snapshot")}`);
test(
  "targetPoolId points to a stale / unknown pool",
  "target pool must exist in current APY data",
  { ...BASE_DECISION, targetPoolId: "pool-GHOST" },
  [POOL_A, POOL_B],
  false  // expect: blocked
);

// ─────────────────────────────────────────────────────────────
// RULE 3 — Source pool is experimental tier
// ─────────────────────────────────────────────────────────────
console.log(`\n${BOLD("[ 3 ] Source pool tier = experimental")}`);
const EXPERIMENTAL_SRC: PoolInfo = { ...POOL_A, id: "pool-exp-src", tier: "experimental" };
test(
  "Trying to withdraw from an experimental protocol",
  "source tier must be 'established'",
  { ...BASE_DECISION, sourcePoolId: "pool-exp-src" },
  [EXPERIMENTAL_SRC, POOL_B],
  false  // expect: blocked
);

// ─────────────────────────────────────────────────────────────
// RULE 4 — Target pool is experimental tier
// ─────────────────────────────────────────────────────────────
console.log(`\n${BOLD("[ 4 ] Target pool tier = experimental (honeypot vector)")}`);
const EXPERIMENTAL_TGT: PoolInfo = {
  ...POOL_B,
  id: "pool-exp-tgt",
  tier: "experimental",
  apy: 22.0,  // tempting APY — gate must still block it
};
test(
  "AI seduced by 22% APY on experimental protocol",
  "target tier must be 'established'",
  { ...BASE_DECISION, targetPoolId: "pool-exp-tgt" },
  [POOL_A, EXPERIMENTAL_TGT],
  false  // expect: blocked
);

// ─────────────────────────────────────────────────────────────
// RULE 5 — Net APY gain below 1.5% threshold
// ─────────────────────────────────────────────────────────────
console.log(`\n${BOLD("[ 5 ] Net gain below 1.5% minimum threshold")}`);
const LOW_GAIN_TARGET: PoolInfo = { ...POOL_B, id: "pool-low", apy: 9.0 }; // only +1.0% vs source
test(
  "Moving from 8% to 9% pool — not worth the gas",
  "net gain must be >= 1.5%",
  { ...BASE_DECISION, targetPoolId: "pool-low" },
  [POOL_A, LOW_GAIN_TARGET],
  false  // expect: blocked
);

// ─────────────────────────────────────────────────────────────
// RULE 5b — Gain exactly at threshold (1.5%) must pass
// ─────────────────────────────────────────────────────────────
const EDGE_TARGET: PoolInfo = { ...POOL_B, id: "pool-edge", apy: 9.5 }; // exactly +1.5%
test(
  "Exactly +1.5% gain — boundary must be APPROVED",
  "net gain >= 1.5% (boundary check)",
  { ...BASE_DECISION, targetPoolId: "pool-edge" },
  [POOL_A, EDGE_TARGET],
  true  // expect: approved
);

// ─────────────────────────────────────────────────────────────
// RULE 6 — Target APY exceeds 25% honeypot cap
// ─────────────────────────────────────────────────────────────
console.log(`\n${BOLD("[ 6 ] Target APY > 25% honeypot cap")}`);
const HONEYPOT: PoolInfo = { ...POOL_B, id: "pool-honey", apy: 40.0, tier: "established" };
test(
  "40% APY pool — looks juicy, but gate must block it",
  "target APY must be <= 25%",
  { ...BASE_DECISION, targetPoolId: "pool-honey" },
  [POOL_A, HONEYPOT],
  false  // expect: blocked
);

// Boundary: exactly 25% APY must still pass
const AT_CAP: PoolInfo = { ...POOL_B, id: "pool-cap", apy: 25.0, tier: "established" };
test(
  "Exactly 25% APY — boundary must be APPROVED",
  "target APY <= 25% (boundary check)",
  { ...BASE_DECISION, targetPoolId: "pool-cap" },
  [POOL_A, AT_CAP],
  true  // expect: approved
);

// ─────────────────────────────────────────────────────────────
// RULE 7 — amountPercent out of range
// ─────────────────────────────────────────────────────────────
console.log(`\n${BOLD("[ 7 ] amountPercent out of valid range [1, 100]")}`);
test(
  "amountPercent = 0 — no actual movement",
  "amountPercent must be in [1, 100]",
  { ...BASE_DECISION, amountPercent: 0 },
  [POOL_A, POOL_B],
  false  // expect: blocked
);
test(
  "amountPercent = 101 — overflow attempt",
  "amountPercent must be in [1, 100]",
  { ...BASE_DECISION, amountPercent: 101 },
  [POOL_A, POOL_B],
  false  // expect: blocked
);
test(
  "amountPercent = 100 — full position move, boundary must pass",
  "amountPercent = 100 is valid",
  { ...BASE_DECISION, amountPercent: 100 },
  [POOL_A, POOL_B],
  true  // expect: approved
);

// ─────────────────────────────────────────────────────────────
// RULE 8 — Hold / unknown actions bypass the gate entirely
// ─────────────────────────────────────────────────────────────
console.log(`\n${BOLD("[ 8 ] Hold and unknown actions are always safe")}`);
test(
  "action = hold — no funds move, always approved",
  "hold bypasses all checks",
  { ...BASE_DECISION, action: "hold" },
  [POOL_A, POOL_B],
  true  // expect: approved
);
test(
  "action = unknown — treated as hold",
  "unknown bypasses all checks",
  { ...BASE_DECISION, action: "unknown" },
  [POOL_A, POOL_B],
  true  // expect: approved
);

// ─────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${BOLD("══════════════════════════════════════════════════════════════")}`);
if (failed === 0) {
  console.log(GREEN(BOLD(`  ✓ All ${total} safety gate tests passed`)));
  console.log(GREEN(`    Every rule fires exactly when it should — and not before.`));
} else {
  console.log(RED(BOLD(`  ✗ ${failed} of ${total} tests failed — safety gate has a gap`)));
}
console.log(BOLD("══════════════════════════════════════════════════════════════\n"));

process.exit(failed > 0 ? 1 : 0);
