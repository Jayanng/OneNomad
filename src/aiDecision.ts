import Groq from "groq-sdk";
import { Mistral } from "@mistralai/mistralai";
import type { AIDecision, PoolInfo, PositionEntry } from "./types";

// ── Client instances (lazy-initialised to avoid crashing on missing keys) ────

let groqClient: Groq | null = null;
let mistralClient: Mistral | null = null;

function getGroq(): Groq {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY ?? "" });
  }
  return groqClient;
}

function getMistral(): Mistral {
  if (!mistralClient) {
    mistralClient = new Mistral({ apiKey: process.env.MISTRAL_API_KEY ?? "" });
  }
  return mistralClient;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are OneNomad, an autonomous DeFi yield optimizer running on OneChain.
Your job is to decide whether to rebalance funds between liquidity pools to maximize yield.

You will be given:
1. availablePools: A JSON array of all available liquidity pools with current APYs.
2. currentPositions: A JSON array of your CURRENT POSITIONS (where your money is right now).

You must respond with ONLY a valid JSON object.

STRICT DECISION RULES:
1. DEFAULT TO "hold": If your current APY is already the highest among all pools, or if the best alternative pool offers less than 0.5% APY improvement, you MUST respond with "action": "hold".
2. VERIFY THE MATH: Double-check your subtraction. (Target APY - Source APY) must be >= 0.5. If the result is negative or small, you MUST "hold".
3. TIER GUARD: You may recommend pools with tier "established" OR "experimental". Favor "established" for stability, but "experimental" is allowed for high yield.
4. HONEYPOT GUARD: Never recommend a target APY > 50% (risk cap raised for testing).
5. SOURCE GUARD: "sourcePoolId" MUST be a pool where you currently have funds (allocatedPct > 0).

Output Format:
{
  "action": "rebalance" | "hold",
  "sourcePoolId": "...",
  "targetPoolId": "...",
  "amountPercent": 100,
  "reasoning": "Specify the exact APY gain, e.g., 'Moving from 8.5% to 14.7% (+6.2% gain)'.",
  "confidence": 0.9
}

Hold Format:
{
  "action": "hold",
  "sourcePoolId": "",
  "targetPoolId": "",
  "amountPercent": 0,
  "reasoning": "Currently in the highest yield pool (14.7% APY).",
  "confidence": 0.95
}`;

// ── Decision logger ───────────────────────────────────────────────────────────

function logDecision(decision: AIDecision, pools: PoolInfo[]): void {
  const src = pools.find(p => p.id === decision.sourcePoolId);
  const tgt = pools.find(p => p.id === decision.targetPoolId);

  const srcApy  = src ? src.apy   : null;
  const tgtApy  = tgt ? tgt.apy   : null;
  const netGain = srcApy !== null && tgtApy !== null ? tgtApy - srcApy : null;

  const srcLabel = src ? `${src.protocol} ${src.tokenA.split("::").pop()}/${src.tokenB.split("::").pop()}` : "—";
  const tgtLabel = tgt ? `${tgt.protocol} ${tgt.tokenA.split("::").pop()}/${tgt.tokenB.split("::").pop()}` : "—";

  console.log("[aiDecision] ─────────────────────────────────────────");
  console.log(`[aiDecision] Model      : ${decision.modelUsed}`);

  if (decision.action === "rebalance") {
    console.log(`[aiDecision] Action     : REBALANCE`);
    console.log(`[aiDecision] Source     : ${srcLabel}  APY ${srcApy !== null ? srcApy.toFixed(2) + "%" : "—"}`);
    console.log(`[aiDecision] Target     : ${tgtLabel}  APY ${tgtApy !== null ? tgtApy.toFixed(2) + "%" : "—"}`);
    console.log(`[aiDecision] Net gain   : ${netGain !== null ? "+" + netGain.toFixed(2) + "%" : "—"}`);
    console.log(`[aiDecision] Amount     : ${decision.amountPercent}%`);
  } else {
    console.log(`[aiDecision] Action     : HOLD`);
    const bestPool = pools.length > 0 ? pools.reduce((a, b) => a.apy > b.apy ? a : b) : null;
    const worstPool = pools.length > 0 ? pools.reduce((a, b) => a.apy < b.apy ? a : b) : null;
    if (bestPool && worstPool) {
      console.log(`[aiDecision] Best APY   : ${bestPool.apy.toFixed(2)}%  (${bestPool.protocol} ${bestPool.tokenA.split("::").pop()}/${bestPool.tokenB.split("::").pop()})`);
      console.log(`[aiDecision] Worst APY  : ${worstPool.apy.toFixed(2)}%  (${worstPool.protocol} ${worstPool.tokenA.split("::").pop()}/${worstPool.tokenB.split("::").pop()})`);
      console.log(`[aiDecision] Spread     : ${(bestPool.apy - worstPool.apy).toFixed(2)}%  (below 1.5% threshold or honeypot blocked)`);
    }
  }

  console.log(`[aiDecision] Confidence : ${(decision.confidence * 100).toFixed(0)}%`);
  console.log(`[aiDecision] Reasoning  : ${decision.reasoning}`);
  console.log("[aiDecision] ─────────────────────────────────────────");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get an AI rebalancing decision.
 * Chain: Groq (llama-3.3-70b) → Mistral (mistral-small-latest) → safe hold default.
 */
export async function getAIDecision(pools: PoolInfo[], currentPositions: PositionEntry[], threshold: number): Promise<AIDecision> {
  const context = {
    availablePools: pools,
    currentPositions: currentPositions,
    rebalanceThresholdPct: threshold,
  };
  const userMessage = JSON.stringify(context, null, 2);

  console.log(`[aiDecision] Querying ${pools.length} pools — best APY ${pools.length > 0 ? Math.max(...pools.map(p => p.apy)).toFixed(2) + "%" : "—"}`);

  // 3. Last line of defense: Programmatic verification
  const finalDecision = await (async () => {
    // try Groq
    if (process.env.GROQ_API_KEY) {
      try {
        const raw = await callGroq(userMessage);
        return parseDecision(raw, "llama-3.3-70b-versatile");
      } catch (err) {
        console.warn("[aiDecision] Groq failed, falling back to Mistral:", String(err).slice(0, 120));
      }
    }

    // try Mistral
    if (process.env.MISTRAL_API_KEY) {
      try {
        const raw = await callMistral(userMessage);
        return parseDecision(raw, "mistral-small-latest");
      } catch (err) {
        console.warn("[aiDecision] Mistral also failed:", String(err).slice(0, 120));
      }
    }

    return safeHoldDecision("all-ai-providers-failed");
  })();

  // 4. Enforce the rule programmatically to handle LLM arithmetic errors
  if (finalDecision.action === "rebalance") {
    const src = pools.find(p => p.id === finalDecision.sourcePoolId);
    const tgt = pools.find(p => p.id === finalDecision.targetPoolId);
    
    if (src && tgt) {
      const gain = tgt.apy - src.apy;
      if (gain < threshold) {
        console.warn(`[aiDecision] ⚠ AI suggested rebalance with insufficient gain (${gain.toFixed(2)}%). Threshold is ${threshold}%. Overriding to HOLD.`);
        const overridden = safeHoldDecision(`insufficient-gain-override (${gain.toFixed(2)}% < ${threshold}%)`);
        overridden.modelUsed = finalDecision.modelUsed;
        logDecision(overridden, pools);
        return overridden;
      }
    } else {
      console.warn(`[aiDecision] ⚠ AI suggested invalid pool IDs. Overriding to HOLD.`);
      const overridden = safeHoldDecision("invalid-pool-ids-returned");
      overridden.modelUsed = finalDecision.modelUsed;
      logDecision(overridden, pools);
      return overridden;
    }
  }

  // 5. Programmatic override: if AI holds but a better pool exists above threshold, force rebalance.
  if (finalDecision.action === "hold" && currentPositions.length > 0) {
    const MAX_ALLOWED_APY = 50;
    // Find the pool we're currently in (highest allocatedPct)
    const topPosition = currentPositions.reduce((a, b) => a.allocatedPct > b.allocatedPct ? a : b);
    const currentPool = pools.find(p => p.id === topPosition.poolId);

    if (currentPool) {
      // Find the best pool we are NOT currently in, that's within the safety cap
      const bestAlternative = pools
        .filter(p => p.id !== currentPool.id && p.apy <= MAX_ALLOWED_APY)
        .sort((a, b) => b.apy - a.apy)[0];

      if (bestAlternative && (bestAlternative.apy - currentPool.apy) >= threshold) {
        console.warn(
          `[aiDecision] ⚠ AI held despite ${(bestAlternative.apy - currentPool.apy).toFixed(2)}% gain available ` +
          `(${currentPool.apy.toFixed(2)}% → ${bestAlternative.apy.toFixed(2)}%). Programmatic override: REBALANCE.`
        );
        const overridden: AIDecision = {
          action: "rebalance",
          sourcePoolId: currentPool.id,
          targetPoolId: bestAlternative.id,
          amountPercent: 100,
          reasoning: `Programmatic override: moving from ${currentPool.apy.toFixed(2)}% to ${bestAlternative.apy.toFixed(2)}% (+${(bestAlternative.apy - currentPool.apy).toFixed(2)}% gain)`,
          confidence: 0.95,
          modelUsed: `${finalDecision.modelUsed}+override`,
        };
        logDecision(overridden, pools);
        return overridden;
      }
    }
  }

  logDecision(finalDecision, pools);
  return finalDecision;
}

// ── Provider calls ────────────────────────────────────────────────────────────

async function callGroq(userMessage: string): Promise<string> {
  const completion = await getGroq().chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: 0.1,    // low temperature for consistent JSON output
    max_tokens: 512,
    response_format: { type: "json_object" },
  }, { timeout: 45_000 });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Groq returned empty content");
  return content;
}

async function callMistral(userMessage: string): Promise<string> {
  const response = await getMistral().chat.complete({
    model: "mistral-small-latest",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: userMessage },
    ],
    temperature: 0.1,
    maxTokens: 512,
    responseFormat: { type: "json_object" },
  }, { timeoutMs: 30_000 });

  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error("Mistral returned empty content");
  return typeof content === "string" ? content : JSON.stringify(content);
}

// ── Parsing & validation ──────────────────────────────────────────────────────

function parseDecision(raw: string, modelUsed: string): AIDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`[aiDecision] parseDecision raw output: ${raw.slice(0, 500)}`);
    throw new Error(`AI returned non-JSON response: ${raw.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("AI returned null or non-object JSON");
  }

  const obj = parsed as Record<string, unknown>;

  const action = obj["action"];
  if (action !== "rebalance" && action !== "hold") {
    throw new Error(`Invalid action '${action}' — must be 'rebalance' or 'hold'`);
  }

  const sourcePoolId = typeof obj["sourcePoolId"] === "string" ? obj["sourcePoolId"] : "";
  const targetPoolId = typeof obj["targetPoolId"] === "string" ? obj["targetPoolId"] : "";

  const amountPercent = Number(obj["amountPercent"]);
  if (action === "rebalance") {
    if (!isFinite(amountPercent) || amountPercent < 10 || amountPercent > 100) {
      throw new Error(`Invalid amountPercent '${obj["amountPercent"]}' for rebalance — must be 10–100`);
    }
  } else {
    // For "hold", amountPercent is usually 0 but we accept anything 0-100
    if (!isFinite(amountPercent) || amountPercent < 0 || amountPercent > 100) {
      throw new Error(`Invalid amountPercent '${obj["amountPercent"]}' — must be 0–100`);
    }
  }

  const rawConfidence = Number(obj["confidence"]);
  if (!isFinite(rawConfidence) || rawConfidence < 0 || rawConfidence > 1) {
    throw new Error(`Invalid confidence '${obj["confidence"]}' — must be 0.0–1.0`);
  }
  const confidence = Math.min(0.99, rawConfidence);

  const reasoning =
    typeof obj["reasoning"] === "string" && obj["reasoning"].length > 0
      ? obj["reasoning"]
      : "No reasoning provided";

  return { action, sourcePoolId, targetPoolId, amountPercent, reasoning, confidence, modelUsed };
}

function safeHoldDecision(reason: string): AIDecision {
  return {
    action: "hold",
    sourcePoolId: "",
    targetPoolId: "",
    amountPercent: 0,
    reasoning: `Safe hold — ${reason}`,
    confidence: 0,
    modelUsed: "fallback",
  };
}
