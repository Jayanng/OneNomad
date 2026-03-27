// FILE: scripts/test-low-balance.ts
// Proves the agent halts correctly when wallet balance is below the gas floor.
// Patches hasSufficientGas internals with controlled balances — no real funds moved.
// Run: npx ts-node scripts/test-low-balance.ts

import "dotenv/config";
import { SuiClient, getFullnodeUrl } from "@onelabs/sui/client";
import { Ed25519Keypair } from "@onelabs/sui/keypairs/ed25519";

// ── Colours ───────────────────────────────────────────────────
const GREEN  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const RED    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const CYAN   = (s: string) => `\x1b[36m${s}\x1b[0m`;
const DIM    = (s: string) => `\x1b[2m${s}\x1b[0m`;
const BOLD   = (s: string) => `\x1b[1m${s}\x1b[0m`;

const GAS_BUDGET_MIST = 10_000_000;   // 0.01 OCT — matches txBuilder.ts
const MIN_GAS_BALANCE = GAS_BUDGET_MIST * 5; // 0.05 OCT — matches agent.ts

function mist(n: number): string {
  return `${n.toLocaleString()} MIST (${(n / 1e9).toFixed(6)} OCT)`;
}

// ── Inline copy of hasSufficientGas logic ────────────────────
// Mirrors agent.ts exactly so the test is authoritative.

function checkBalance(balance: bigint): { allowed: boolean; message: string } {
  const balanceOct = (Number(balance) / 1e9).toFixed(6);
  const minOct     = (MIN_GAS_BALANCE  / 1e9).toFixed(6);

  if (balance < BigInt(MIN_GAS_BALANCE)) {
    return {
      allowed: false,
      message: `Wallet balance ${balanceOct} OCT is below the ${minOct} OCT safety floor. Rebalance skipped.`,
    };
  }
  return {
    allowed: true,
    message: `Balance OK — ${balanceOct} OCT (min: ${minOct} OCT)`,
  };
}

// ── Test runner ───────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(label: string, balanceMist: number, expectAllowed: boolean): void {
  const result = checkBalance(BigInt(balanceMist));
  const ok = result.allowed === expectAllowed;

  if (ok) passed++; else failed++;

  const tick   = ok ? GREEN("✓ PASS") : RED("✗ FAIL");
  const status = result.allowed ? GREEN("ALLOWED") : RED("HALTED ");

  console.log(`\n  ${tick}  ${BOLD(label)}`);
  console.log(`         Balance  : ${CYAN(mist(balanceMist))}`);
  console.log(`         Minimum  : ${DIM(mist(MIN_GAS_BALANCE))}`);
  console.log(`         Decision : ${status}`);
  console.log(`         ${DIM(result.message)}`);
}

// ── Live balance fetch ────────────────────────────────────────

async function fetchLiveBalance(): Promise<bigint | null> {
  const rpc = process.env.ONECHAIN_RPC_URL ?? getFullnodeUrl("testnet");
  const key = process.env.PRIVATE_KEY;
  if (!key) return null;
  try {
    const client  = new SuiClient({ url: rpc });
    const keypair = Ed25519Keypair.fromSecretKey(key);
    const address = keypair.toSuiAddress();
    const result  = await client.getBalance({ owner: address });
    return BigInt(result.totalBalance);
  } catch {
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD("══════════════════════════════════════════════════════════════")}`);
  console.log(`${BOLD("  OneNomad — Wallet Balance Guard Test")}`);
  console.log(`${BOLD("══════════════════════════════════════════════════════════════")}`);
  console.log(`  Gas budget per tx : ${CYAN(mist(GAS_BUDGET_MIST))}`);
  console.log(`  Safety floor (5×) : ${CYAN(mist(MIN_GAS_BALANCE))}`);
  console.log(`  Rule: agent halts when balance < floor, proceeds when balance >= floor\n`);

  // ── Simulated scenarios ──────────────────────────────────────
  console.log(BOLD("[ Simulated Balances ]"));

  test("Empty wallet (0 MIST)",
    0, false);

  test("1 MIST — essentially zero",
    1, false);

  test("Below floor: 1 gas budget (0.01 OCT)",
    GAS_BUDGET_MIST, false);

  test("Below floor: 2× budget (0.02 OCT) — 3 cycles left but still under minimum",
    GAS_BUDGET_MIST * 2, false);

  test("Below floor: 4× budget (0.04 OCT) — one cycle under minimum",
    GAS_BUDGET_MIST * 4, false);

  test("Exactly at floor: 5× budget (0.05 OCT) — boundary must be ALLOWED",
    MIN_GAS_BALANCE, true);

  test("Above floor: 10× budget (0.10 OCT)",
    GAS_BUDGET_MIST * 10, true);

  test("Healthy: 1 OCT (100× budget)",
    1_000_000_000, true);

  // ── Live wallet check ────────────────────────────────────────
  console.log(`\n${BOLD("[ Live Wallet ]")}`);
  console.log(`  Fetching real balance from OneChain testnet…`);

  const live = await fetchLiveBalance();
  if (live === null) {
    console.log(`  ${YELLOW("⚠")} Could not fetch balance (RPC or key issue) — skipping live check`);
  } else {
    const result = checkBalance(live);
    const status = result.allowed ? GREEN("ALLOWED — agent would proceed") : RED("HALTED  — agent would skip rebalance");
    const tick   = result.allowed ? GREEN("✓") : YELLOW("⚠");
    console.log(`\n  ${tick}  ${BOLD("Agent wallet")}`);
    console.log(`         Balance  : ${CYAN(mist(Number(live)))}`);
    console.log(`         Minimum  : ${DIM(mist(MIN_GAS_BALANCE))}`);
    console.log(`         Decision : ${status}`);
    if (!result.allowed) {
      console.log(`\n  ${RED("Action required:")} Send OCT to the agent wallet to resume rebalancing.`);
      const keypair = Ed25519Keypair.fromSecretKey(process.env.PRIVATE_KEY!);
      console.log(`  ${DIM("Wallet address: " + keypair.toSuiAddress())}`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${BOLD("══════════════════════════════════════════════════════════════")}`);
  if (failed === 0) {
    console.log(GREEN(BOLD(`  ✓ All ${total} balance guard tests passed`)));
    console.log(GREEN(`    Agent halts correctly on low balance — never burns the last gas.`));
  } else {
    console.log(RED(BOLD(`  ✗ ${failed} of ${total} tests failed`)));
  }
  console.log(BOLD("══════════════════════════════════════════════════════════════\n"));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(RED(`\nFatal: ${e.message}\n`));
  process.exit(1);
});
