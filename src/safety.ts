import type { AIDecision, PoolInfo, SafetyResult } from "./types";

const MIN_APY_GAIN_PCT = 0.5;
const MAX_APY_CHASE_PCT = 50; // never chase unrealistically high APYs

/**
 * Pure validation gate — no external dependencies.
 * Defence-in-depth: enforces rules even if the AI prompt already includes them.
 */
export function validateDecision(
  decision: AIDecision,
  pools: PoolInfo[],
  minApyGain: number = 0.5
): SafetyResult {
  // Hold actions are always safe — no funds move
  if (decision.action === "hold" || decision.action === "unknown") {
    return { approved: true, reason: "hold action — no risk" };
  }

  const source = pools.find((p) => p.id === decision.sourcePoolId);
  const target = pools.find((p) => p.id === decision.targetPoolId);

  if (!source) {
    return {
      approved: false,
      reason: `source pool '${decision.sourcePoolId}' not found in current APY data`,
    };
  }

  if (!target) {
    return {
      approved: false,
      reason: `target pool '${decision.targetPoolId}' not found in current APY data`,
    };
  }

  // ALLOW both established and experimental tiers
  const allowedTiers = ["established", "experimental"];

  if (!allowedTiers.includes(source.tier)) {
    return {
      approved: false,
      reason: `source protocol '${source.protocol}' is tier '${source.tier}', not in allowed list [${allowedTiers.join(", ")}]`,
    };
  }

  if (!allowedTiers.includes(target.tier)) {
    return {
      approved: false,
      reason: `target protocol '${target.protocol}' is tier '${target.tier}', not in allowed list [${allowedTiers.join(", ")}]`,
    };
  }

  const gain = target.apy - source.apy;

  if (gain < minApyGain) {
    return {
      approved: false,
      reason: `net gain ${gain.toFixed(2)}% is below minimum ${minApyGain}% threshold`,
    };
  }

  if (target.apy > MAX_APY_CHASE_PCT) {
    return {
      approved: false,
      reason: `target APY ${target.apy.toFixed(2)}% exceeds the ${MAX_APY_CHASE_PCT}% safety cap — likely a honeypot or error`,
    };
  }

  if (decision.amountPercent < 1 || decision.amountPercent > 100) {
    return {
      approved: false,
      reason: `amountPercent ${decision.amountPercent} is out of valid range [1, 100]`,
    };
  }

  return {
    approved: true,
    reason: `net gain ${gain.toFixed(2)}% passes all safety checks`,
  };
}
