// FILE: scripts/simulate-ai.ts
// Simulates the full AI decision engine with multiple mock APY scenarios
// and prints the complete reasoning output for each.
// Run: npx ts-node scripts/simulate-ai.ts

import "dotenv/config";
import { getAIDecision } from "../src/aiDecision";
import { validateDecision } from "../src/safety";
import type { PoolInfo } from "../src/types";

// ── Colour helpers ────────────────────────────────────────────
const GREEN  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const RED    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const CYAN   = (s: string) => `\x1b[36m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const DIM    = (s: string) => `\x1b[2m${s}\x1b[0m`;
const BOLD   = (s: string) => `\x1b[1m${s}\x1b[0m`;
const MAGENTA = (s: string) => `\x1b[35m${s}\x1b[0m`;

function bar(pct: number, width = 30): string {
  const filled = Math.round((pct / 100) * width);
  return CYAN("█".repeat(filled)) + DIM("░".repeat(width - filled));
}

function confidence(n: number): string {
  const label = n >= 0.85 ? GREEN("HIGH") : n >= 0.65 ? YELLOW("MEDIUM") : RED("LOW");
  return `${(n * 100).toFixed(0)}%  ${label}`;
}

// ── Mock pool datasets ────────────────────────────────────────

const PKG = "0x72fa7314e418257f60f0c3a98625b95369f58fa2733f08e30ba0610fb6276f55";

const BASE_POOLS: PoolInfo[] = [
  {
    id: process.env.POOL_OCT_USDC_ID!,
    protocol: "OneDEX",
    tier: "established",
    tokenA: `${PKG}::oct::OCT`,
    tokenB: `${PKG}::usdc::USDC`,
    apy: 0,       // overridden per scenario
    tvlUsd: 2_100_000,
    fetchedAt: Date.now(),
  },
  {
    id: process.env.POOL_OCT_USDT_ID!,
    protocol: "OneDEX",
    tier: "established",
    tokenA: `${PKG}::oct::OCT`,
    tokenB: `${PKG}::usdt::USDT`,
    apy: 0,
    tvlUsd: 1_800_000,
    fetchedAt: Date.now(),
  },
  {
    id: process.env.POOL_USDC_USDT_ID!,
    protocol: "OneDEX",
    tier: "established",
    tokenA: `${PKG}::usdc::USDC`,
    tokenB: `${PKG}::usdt::USDT`,
    apy: 0,
    tvlUsd: 4_000_000,
    fetchedAt: Date.now(),
  },
  {
    id: process.env.POOL_VAULT_STABLE_ID!,
    protocol: "OneVault",
    tier: "established",
    tokenA: `${PKG}::oct::OCT`,
    tokenB: `${PKG}::usdt::USDT`,
    apy: 0,
    tvlUsd: 3_000_000,
    fetchedAt: Date.now(),
  },
  {
    id: process.env.POOL_VAULT_HIGH_ID!,
    protocol: "OneVault",
    tier: "experimental",   // intentionally experimental — safety gate should catch any rebalance into this
    tokenA: `${PKG}::usdc::USDC`,
    tokenB: `${PKG}::usdt::USDT`,
    apy: 0,
    tvlUsd: 500_000,
    fetchedAt: Date.now(),
  },
];

function makePools(apys: number[]): PoolInfo[] {
  return BASE_POOLS.map((p, i) => ({ ...p, apy: apys[i] }));
}

const SCENARIOS: { name: string; desc: string; apys: number[] }[] = [
  {
    name: "SCENARIO 1 — Clear Rebalance Opportunity",
    desc: "OCT/USDC at 8% APY, OCT/USDT surging to 18% — AI should rebalance",
    apys: [8.0, 18.0, 5.5, 12.0, 22.0],
  },
  {
    name: "SCENARIO 2 — Marginal Gain (Below Threshold)",
    desc: "Best pool only 1.0% better than current — should hold (< 1.5% rule)",
    apys: [12.0, 13.0, 6.0, 11.5, 7.0],
  },
  {
    name: "SCENARIO 3 — Honeypot Trap",
    desc: "One pool showing 40% APY — safety gate must block it",
    apys: [10.0, 40.0, 5.0, 9.0, 38.0],
  },
  {
    name: "SCENARIO 4 — All Pools Similar APY",
    desc: "No meaningful difference — AI should hold",
    apys: [14.2, 14.5, 13.8, 14.0, 14.3],
  },
  {
    name: "SCENARIO 5 — Stable Pool Dominates",
    desc: "Vault stable pool at 20% while others lag — strong rebalance signal",
    apys: [9.0, 10.0, 4.5, 20.0, 25.5],
  },
];

// ── Rule-based fallback decision (no API needed) ─────────────
// Mirrors the exact rules in the AI system prompt + safety.ts

function ruleBasedDecision(pools: PoolInfo[]): import("../src/types").AIDecision {
  const MIN_GAIN = 1.5;
  const MAX_APY  = 25;
  const established = pools.filter(p => p.tier === "established");
  const sorted  = [...established].sort((a, b) => b.apy - a.apy);
  const best    = sorted[0];
  const current = sorted[sorted.length - 1]; // lowest APY = "current"

  if (!best || !current || best.id === current.id) {
    return { action: "hold", sourcePoolId: "", targetPoolId: "", amountPercent: 0,
      reasoning: "All pools have identical APY — no rebalance opportunity.", confidence: 0.97, modelUsed: "rule-engine" };
  }

  const gain = best.apy - current.apy;

  if (best.apy > MAX_APY) {
    return { action: "hold", sourcePoolId: "", targetPoolId: "", amountPercent: 0,
      reasoning: `Best pool APY ${best.apy}% exceeds ${MAX_APY}% safety cap — likely a honeypot or data anomaly. Holding.`,
      confidence: 0.99, modelUsed: "rule-engine" };
  }

  if (gain < MIN_GAIN) {
    return { action: "hold", sourcePoolId: "", targetPoolId: "", amountPercent: 0,
      reasoning: `Best available gain is only ${gain.toFixed(2)}% — below the ${MIN_GAIN}% minimum threshold. Not worth the gas.`,
      confidence: 0.88, modelUsed: "rule-engine" };
  }

  return {
    action: "rebalance",
    sourcePoolId: current.id,
    targetPoolId: best.id,
    amountPercent: 100,
    reasoning: `${best.protocol} pool offers ${best.apy}% APY vs current ${current.apy}% — a net gain of ${gain.toFixed(2)}% exceeds the ${MIN_GAIN}% threshold. Rebalancing full position.`,
    confidence: Math.min(0.99, 0.70 + gain * 0.015),
    modelUsed: "rule-engine",
  };
}

// ── Runner ────────────────────────────────────────────────────

async function runScenario(
  scenario: typeof SCENARIOS[0],
  index: number,
  total: number
): Promise<void> {
  const pools = makePools(scenario.apys);

  console.log(`\n${"─".repeat(62)}`);
  console.log(BOLD(`  [${index + 1}/${total}] ${scenario.name}`));
  console.log(DIM(`  ${scenario.desc}`));
  console.log(`${"─".repeat(62)}`);

  // Print pool table
  console.log(DIM("\n  Pool Snapshot:"));
  console.log(DIM("  ┌────────────────────────┬──────────────┬───────┬──────────────────────────────┐"));
  console.log(DIM("  │ Pool                   │ Protocol     │  APY  │ TVL                          │"));
  console.log(DIM("  ├────────────────────────┼──────────────┼───────┼──────────────────────────────┤"));
  pools.forEach(p => {
    const tokenA = p.tokenA.split("::").pop()!.padEnd(4);
    const tokenB = p.tokenB.split("::").pop()!.padEnd(4);
    const name   = `${tokenA}/${tokenB}`.padEnd(22);
    const proto  = `${p.protocol} (${p.tier})`.padEnd(12);
    const apy    = p.apy.toFixed(1).padStart(5) + "%";
    const tvl    = `$${(p.tvlUsd / 1_000_000).toFixed(1)}M`;
    const apyStr = p.apy >= 25 ? RED(apy) : p.apy >= 15 ? YELLOW(apy) : GREEN(apy);
    console.log(`  │ ${name} │ ${proto} │ ${apyStr} │ ${tvl.padEnd(28)} │`);
  });
  console.log(DIM("  └────────────────────────┴──────────────┴───────┴──────────────────────────────┘"));

  // Call AI — fall back to rule engine if both providers fail
  console.log(`\n  ${MAGENTA("⟳")} Calling AI decision engine…`);
  const t0 = Date.now();
  let decision = await getAIDecision(pools);
  if (decision.modelUsed === "fallback") {
    console.log(`  ${YELLOW("⚠")}  AI providers unavailable — using rule-based engine`);
    decision = ruleBasedDecision(pools);
  }
  const elapsed = Date.now() - t0;

  // Safety gate
  const safety = validateDecision(decision, pools);

  // Find source/target pool names
  const src = pools.find(p => p.id === decision.sourcePoolId);
  const tgt = pools.find(p => p.id === decision.targetPoolId);
  const srcName = src ? `${src.tokenA.split("::").pop()}/${src.tokenB.split("::").pop()} (${src.apy}%)` : "—";
  const tgtName = tgt ? `${tgt.tokenA.split("::").pop()}/${tgt.tokenB.split("::").pop()} (${tgt.apy}%)` : "—";
  const apyGain = src && tgt ? `+${(tgt.apy - src.apy).toFixed(2)}%` : "—";

  // Decision output
  console.log(`\n  ${BOLD("AI Decision Output:")}`);
  console.log(`  ┌${"─".repeat(56)}┐`);

  const actionStr = decision.action === "rebalance"
    ? GREEN(BOLD("  REBALANCE"))
    : YELLOW(BOLD("  HOLD     "));
  console.log(`  │ Action      : ${actionStr}${" ".repeat(42)}│`);
  console.log(`  │ Model       : ${CYAN(decision.modelUsed.padEnd(42))} │`);
  console.log(`  │ Response in : ${String(elapsed + "ms").padEnd(42)} │`);
  console.log(`  │ Confidence  : ${confidence(decision.confidence).padEnd(55)} │`);

  if (decision.action === "rebalance") {
    console.log(`  │ From        : ${DIM(srcName.padEnd(42))} │`);
    console.log(`  │ To          : ${DIM(tgtName.padEnd(42))} │`);
    console.log(`  │ APY gain    : ${(apyGain).padEnd(42)} │`);
    console.log(`  │ Amount      : ${String(decision.amountPercent + "%").padEnd(42)} │`);
  }

  console.log(`  ├${"─".repeat(56)}┤`);

  // Word-wrap reasoning to 50 chars
  const words = decision.reasoning.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > 50) { lines.push(line.trim()); line = word; }
    else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  console.log(`  │ ${BOLD("Reasoning:")}${" ".repeat(46)} │`);
  lines.forEach(l => console.log(`  │   ${DIM(l.padEnd(53))} │`));

  console.log(`  └${"─".repeat(56)}┘`);

  // Safety gate result
  console.log(`\n  ${BOLD("Safety Gate:")}`);
  if (safety.approved) {
    console.log(`  ${GREEN("✓ APPROVED")}  — ${safety.reason}`);
    if (decision.action === "rebalance") {
      const gain = tgt && src ? tgt.apy - src.apy : 0;
      console.log(`\n  ${BOLD("Confidence bar:")}  ${bar(decision.confidence * 100)}`);
      console.log(`  ${BOLD("APY gain:      ")}  ${bar(Math.min(gain * 5, 100))}  ${YELLOW(apyGain)}`);
    }
  } else {
    console.log(`  ${RED("✗ BLOCKED")}   — ${safety.reason}`);
  }

  // Final verdict
  const verdict = decision.action === "rebalance" && safety.approved
    ? GREEN(BOLD("  → PTB WOULD EXECUTE on-chain"))
    : decision.action === "hold"
    ? YELLOW(BOLD("  → Funds stay put, no transaction"))
    : RED(BOLD("  → Safety gate blocked the rebalance"));
  console.log(`\n  ${verdict}`);
}

async function main() {
  console.log(`\n${BOLD("══════════════════════════════════════════════════════════════")}`);
  console.log(`${BOLD("  OneNomad AI Decision Engine — Simulation")}`);
  console.log(`${BOLD("══════════════════════════════════════════════════════════════")}`);
  console.log(`  Model chain : Groq (llama-3.3-70b) → OpenAI (gpt-4o-mini) → fallback`);
  console.log(`  Safety rules: min +1.5% APY gain · max 25% APY cap · established pools only`);
  console.log(`  Scenarios   : ${SCENARIOS.length} mock APY datasets`);

  for (let i = 0; i < SCENARIOS.length; i++) {
    await runScenario(SCENARIOS[i], i, SCENARIOS.length);
  }

  console.log(`\n${"═".repeat(62)}`);
  console.log(BOLD("  Simulation complete.\n"));
}

main().catch(e => {
  console.error(RED(`\nFatal: ${e.message}\n`));
  process.exit(1);
});
