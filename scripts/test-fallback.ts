// FILE: scripts/test-fallback.ts
// Walks through the full AI provider fallback chain in real time:
//   Stage 1 → Groq forced to fail (key wiped) → Mistral takes over
//   Stage 2 → Mistral also fails (bad key)     → safe-hold default fires
// Each stage is timed and logged step-by-step.
// Run: npx ts-node scripts/test-fallback.ts

import "dotenv/config";
import Groq from "groq-sdk";
import { Mistral } from "@mistralai/mistralai";
import type { AIDecision, PoolInfo } from "../src/types";

// ── Colours ───────────────────────────────────────────────────
const GREEN  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const RED    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const CYAN   = (s: string) => `\x1b[36m${s}\x1b[0m`;
const DIM    = (s: string) => `\x1b[2m${s}\x1b[0m`;
const BOLD   = (s: string) => `\x1b[1m${s}\x1b[0m`;

function ts(): string {
  const d = new Date();
  return DIM(`[${d.getHours()}:${d.getMinutes().toString().padStart(2,"0")}:${d.getSeconds().toString().padStart(2,"0")}.${d.getMilliseconds().toString().padStart(3,"0")}]`);
}

function log(icon: string, label: string, msg: string) {
  console.log(`  ${ts()} ${icon}  ${BOLD(label.padEnd(14))} ${msg}`);
}

// ── Shared prompt (same as production) ───────────────────────
const SYSTEM_PROMPT = `You are OneNomad, an autonomous DeFi yield optimizer running on OneChain.
Your job is to decide whether to rebalance funds between liquidity pools to maximise yield.
You will be given a JSON array of liquidity pools with current APYs.
You must respond with ONLY a valid JSON object.
The JSON must match this exact schema:
{"action":"rebalance"|"hold","sourcePoolId":"<string>","targetPoolId":"<string>","amountPercent":<number 10-100>,"reasoning":"<string>","confidence":<number 0.0-1.0>}
Rules: Only rebalance if gain >= 1.5%. Never chase APY > 25%. If no good move, hold.`;

const MOCK_POOLS: PoolInfo[] = [
  { id: "pool-A", protocol: "OneDEX",   tier: "established", tokenA: "OCT",  tokenB: "USDC", apy: 8.5,  tvlUsd: 2100000, fetchedAt: Date.now() },
  { id: "pool-B", protocol: "OneDEX",   tier: "established", tokenA: "OCT",  tokenB: "USDT", apy: 14.7, tvlUsd: 1800000, fetchedAt: Date.now() },
  { id: "pool-C", protocol: "OneVault", tier: "established", tokenA: "OCT",  tokenB: "USDT", apy: 12.0, tvlUsd: 3000000, fetchedAt: Date.now() },
];

const USER_MSG = JSON.stringify(MOCK_POOLS, null, 2);

// ── Individual provider callers (same logic as aiDecision.ts) ─

async function tryGroq(apiKey: string): Promise<AIDecision> {
  const client = new Groq({ apiKey });
  const t0 = Date.now();
  log("⟳", "Groq", `Sending prompt to ${CYAN("llama-3.3-70b-versatile")}…`);

  const completion = await client.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: USER_MSG },
    ],
    temperature: 0.1,
    max_tokens: 256,
    response_format: { type: "json_object" },
  });

  const elapsed = Date.now() - t0;
  const content = completion.choices[0]?.message?.content ?? "";
  log("✓", "Groq", `Response in ${GREEN(elapsed + "ms")} — ${completion.usage?.total_tokens ?? "?"} tokens`);
  return { ...JSON.parse(content), modelUsed: "llama-3.3-70b-versatile" } as AIDecision;
}

async function tryMistral(apiKey: string): Promise<AIDecision> {
  const client = new Mistral({ apiKey });
  const t0 = Date.now();
  log("⟳", "Mistral", `Sending prompt to ${CYAN("mistral-small-latest")}…`);

  const response = await client.chat.complete({
    model: "mistral-small-latest",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: USER_MSG },
    ],
    temperature: 0.1,
    maxTokens: 256,
    responseFormat: { type: "json_object" },
  });

  const elapsed = Date.now() - t0;
  const raw     = response.choices?.[0]?.message?.content ?? "";
  const content = typeof raw === "string" ? raw : JSON.stringify(raw);
  const tokens  = response.usage?.totalTokens ?? "?";
  log("✓", "Mistral", `Response in ${GREEN(elapsed + "ms")} — ${tokens} tokens`);
  return { ...JSON.parse(content), modelUsed: "mistral-small-latest" } as AIDecision;
}

function safeHold(): AIDecision {
  return {
    action: "hold", sourcePoolId: "", targetPoolId: "",
    amountPercent: 0, reasoning: "Safe hold — all AI providers failed",
    confidence: 0, modelUsed: "fallback",
  };
}

// ── Fallback chain runner ─────────────────────────────────────

async function runFallbackChain(opts: {
  groqKey: string | null;
  mistralKey: string | null;
  label: string;
  desc: string;
}): Promise<void> {
  console.log(`\n${"─".repeat(64)}`);
  console.log(BOLD(`  ${opts.label}`));
  console.log(DIM(`  ${opts.desc}`));
  console.log(`${"─".repeat(64)}`);

  const chainStart = Date.now();
  let decision: AIDecision | null = null;

  // ── Stage 1: Groq ─────────────────────────────────────────
  console.log(`\n  ${BOLD("Stage 1 → Groq")}`);
  if (!opts.groqKey) {
    log("⊘", "Groq", YELLOW("Key not present — skipping"));
  } else {
    log("→", "Groq", `Key: ${CYAN(opts.groqKey.slice(0, 8) + "…" + opts.groqKey.slice(-4))}`);
    try {
      decision = await tryGroq(opts.groqKey);
      log("✓", "Groq", GREEN("SUCCESS — Groq handled the request"));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = msg.includes("429") ? "429 Rate Limited"
                 : msg.includes("401") ? "401 Unauthorized"
                 : msg.includes("timeout") ? "Timeout"
                 : msg.slice(0, 60);
      log("✗", "Groq", RED(`FAILED — ${code}`));
      log("→", "Groq", YELLOW("Handing off to Mistral…"));
    }
  }

  // ── Stage 2: Mistral ──────────────────────────────────────
  if (!decision) {
    console.log(`\n  ${BOLD("Stage 2 → Mistral")}`);
    if (!opts.mistralKey) {
      log("⊘", "Mistral", YELLOW("Key not present — skipping"));
    } else {
      log("→", "Mistral", `Key: ${CYAN(opts.mistralKey.slice(0, 8) + "…" + opts.mistralKey.slice(-4))}`);
      try {
        decision = await tryMistral(opts.mistralKey);
        log("✓", "Mistral", GREEN("SUCCESS — Mistral handled the request"));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = msg.includes("429") ? "429 Rate Limited"
                   : msg.includes("401") ? "401 Unauthorized / Invalid key"
                   : msg.includes("timeout") ? "Timeout"
                   : msg.slice(0, 60);
        log("✗", "Mistral", RED(`FAILED — ${code}`));
        log("→", "Mistral", YELLOW("Handing off to safe-hold fallback…"));
      }
    }
  }

  // ── Stage 3: Safe hold ───────────────────────────────────
  if (!decision) {
    console.log(`\n  ${BOLD("Stage 3 → Safe-Hold Default")}`);
    decision = safeHold();
    log("⚡", "Fallback", YELLOW("Firing safe-hold — zero risk, no funds move"));
  }

  // ── Result ───────────────────────────────────────────────
  const totalMs = Date.now() - chainStart;
  console.log(`\n  ${BOLD("Result:")}`);
  console.log(`  ┌${"─".repeat(52)}┐`);
  const actionStr = decision.action === "rebalance" ? GREEN(BOLD("REBALANCE")) : YELLOW(BOLD("HOLD     "));
  console.log(`  │  Action   : ${actionStr}${" ".repeat(38)}│`);
  console.log(`  │  Model    : ${CYAN(decision.modelUsed.padEnd(38))} │`);
  console.log(`  │  Chain ms : ${String(totalMs + "ms").padEnd(38)} │`);
  console.log(`  │  Confidence: ${String((decision.confidence * 100).toFixed(0) + "%").padEnd(37)} │`);
  if (decision.reasoning) {
    // word-wrap at 46 chars
    const words = decision.reasoning.split(" ");
    const lines: string[] = []; let line = "";
    for (const w of words) {
      if ((line + " " + w).trim().length > 46) { lines.push(line.trim()); line = w; }
      else line = (line + " " + w).trim();
    }
    if (line) lines.push(line);
    console.log(`  ├${"─".repeat(52)}┤`);
    console.log(`  │  ${BOLD("Reasoning:")}${" ".repeat(41)} │`);
    lines.forEach(l => console.log(`  │    ${DIM(l.padEnd(48))} │`));
  }
  console.log(`  └${"─".repeat(52)}┘`);

  const resolved = decision.modelUsed === "fallback"
    ? RED("✗  All providers failed — safe hold fired")
    : decision.modelUsed.includes("llama")
    ? GREEN("✓  Groq answered")
    : GREEN("✓  Mistral answered (Groq was down)");
  console.log(`\n  ${resolved}\n`);
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  const GROQ_KEY    = process.env.GROQ_API_KEY    ?? null;
  const MISTRAL_KEY = process.env.MISTRAL_API_KEY ?? null;

  console.log(`\n${BOLD("════════════════════════════════════════════════════════════════")}`);
  console.log(`${BOLD("  OneNomad — Live Fallback Chain Demonstration")}`);
  console.log(`${BOLD("════════════════════════════════════════════════════════════════")}`);
  console.log(`  Groq key    : ${GROQ_KEY    ? GREEN("present") : RED("missing")}`);
  console.log(`  Mistral key : ${MISTRAL_KEY ? GREEN("present") : RED("missing")}`);
  console.log(`\n  Pool data  : ${MOCK_POOLS.length} pools — best APY ${Math.max(...MOCK_POOLS.map(p=>p.apy))}% (pool-B OCT/USDT)`);

  // Test 1: Groq present, Mistral as backup (normal production path)
  await runFallbackChain({
    groqKey:    GROQ_KEY,
    mistralKey: MISTRAL_KEY,
    label: "TEST 1 — Normal production path (Groq → Mistral → fallback)",
    desc:  "Both keys loaded from .env. Groq tries first, Mistral waits on standby.",
  });

  // Test 2: Groq explicitly wiped → Mistral must handle it
  await runFallbackChain({
    groqKey:    null,
    mistralKey: MISTRAL_KEY,
    label: "TEST 2 — Groq unavailable (key wiped) → Mistral takes over",
    desc:  "Simulates Groq outage / key rotation. Mistral is the sole provider.",
  });

  // Test 3: Both wiped → safe-hold must fire
  await runFallbackChain({
    groqKey:    null,
    mistralKey: null,
    label: "TEST 3 — Both providers down → safe-hold default",
    desc:  "Worst case: no AI available. Agent falls back to zero-risk hold.",
  });

  console.log(`${"═".repeat(64)}`);
  console.log(BOLD("  Fallback chain demonstration complete.\n"));
  console.log(DIM("  → Get a free Mistral key at: https://console.mistral.ai/api-keys"));
  console.log(DIM("  → Groq rate limit resets within 1 hour on the free tier\n"));
}

main().catch(e => {
  console.error(RED(`\nFatal: ${e.message}\n`));
  process.exit(1);
});
