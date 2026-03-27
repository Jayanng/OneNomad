// FILE: scripts/dry-run-ptb.ts
// Builds the real PTB for a rebalance and dry-runs it against OneChain testnet.
// Prints the full transaction structure, effects, gas, and events before anything hits chain.
// Run: npx ts-node scripts/dry-run-ptb.ts

import "dotenv/config";
import { SuiClient } from "@onelabs/sui/client";
import { Transaction } from "@onelabs/sui/transactions";
import { Ed25519Keypair } from "@onelabs/sui/keypairs/ed25519";
import type { PoolInfo, AIDecision } from "../src/types";

const RPC_URL        = process.env.ONECHAIN_RPC_URL!;
const PKG            = process.env.ONENOMAD_PACKAGE_ID!;
const POSITION_OBJ   = process.env.POSITION_OBJECT_ID!;
const GAS_BUDGET     = 10_000_000;

// ── Colours ───────────────────────────────────────────────────
const GREEN  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const RED    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const CYAN   = (s: string) => `\x1b[36m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const DIM    = (s: string) => `\x1b[2m${s}\x1b[0m`;
const BOLD   = (s: string) => `\x1b[1m${s}\x1b[0m`;

function short(id: string) { return `${id.slice(0, 10)}…${id.slice(-6)}`; }
function mist(n: string | number) { return `${Number(n).toLocaleString()} MIST  (${(Number(n) / 1e9).toFixed(6)} OCT)`; }

// ── Real pool objects from .env ───────────────────────────────
const POOLS: PoolInfo[] = [
  {
    id: process.env.POOL_OCT_USDC_ID!,
    protocol: "OneDEX", tier: "established",
    tokenA: `${PKG}::oct::OCT`,  tokenB: `${PKG}::usdc::USDC`,
    apy: 8.5,  tvlUsd: 2_100_000, fetchedAt: Date.now(),
  },
  {
    id: process.env.POOL_OCT_USDT_ID!,
    protocol: "OneDEX", tier: "established",
    tokenA: `${PKG}::oct::OCT`,  tokenB: `${PKG}::usdt::USDT`,
    apy: 18.7, tvlUsd: 1_800_000, fetchedAt: Date.now(),
  },
];

// Rebalance: 50% of position from OCT/USDC → OCT/USDT (+10.2% APY gain)
const DECISION: AIDecision = {
  action:        "rebalance",
  sourcePoolId:  POOLS[0].id,
  targetPoolId:  POOLS[1].id,
  amountPercent: 50,
  reasoning:     "OCT/USDT offers 18.7% vs 8.5% — net gain 10.2% clears 1.5% threshold.",
  confidence:    0.91,
  modelUsed:     "dry-run-script",
};

// ── PTB builder (mirrors txBuilder.ts exactly) ────────────────
function buildPTB(decision: AIDecision, source: PoolInfo, target: PoolInfo): Transaction {
  const tx     = new Transaction();
  const srcPkg = PKG;  // both protocols share the same package in this deployment
  const tgtPkg = PKG;

  // Step 1 — Withdraw from source pool
  const withdrawResult = tx.moveCall({
    target: `${srcPkg}::pool::withdraw`,
    arguments: [
      tx.object(source.id),
      tx.pure.u64(BigInt(decision.amountPercent)),
      tx.object(POSITION_OBJ),
    ],
    typeArguments: [source.tokenA, source.tokenB],
  });

  // Step 2 — Swap only if tokenA differs between source and target
  const needsSwap = source.tokenA !== target.tokenA;
  let depositArg = withdrawResult;

  if (needsSwap) {
    const swapResult = tx.moveCall({
      target: `${srcPkg}::swap::swap_exact_input`,
      arguments: [
        depositArg,
        tx.pure.u64(BigInt(0)),
      ],
      typeArguments: [source.tokenA, target.tokenA],
    });
    depositArg = swapResult;
  }

  // Step 3 — Deposit into target pool
  tx.moveCall({
    target: `${tgtPkg}::pool::deposit`,
    arguments: [
      tx.object(target.id),
      depositArg,
      tx.object(POSITION_OBJ),
    ],
    typeArguments: [target.tokenA, target.tokenB],
  });

  tx.setGasBudget(GAS_BUDGET);
  return tx;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  const client = new SuiClient({ url: RPC_URL });
  const keypair = Ed25519Keypair.fromSecretKey(process.env.PRIVATE_KEY!);
  const sender  = keypair.toSuiAddress();
  const source = POOLS.find(p => p.id === DECISION.sourcePoolId)!;
  const target = POOLS.find(p => p.id === DECISION.targetPoolId)!;

  console.log(`\n${BOLD("══════════════════════════════════════════════════════════════")}`);
  console.log(`${BOLD("  OneNomad PTB Dry-Run — Full Transaction Preview")}`);
  console.log(`${BOLD("══════════════════════════════════════════════════════════════")}`);
  console.log(`  RPC     : ${CYAN(RPC_URL)}`);
  console.log(`  Package : ${CYAN(short(PKG))}`);
  console.log(`  Position: ${CYAN(short(POSITION_OBJ))}`);
  console.log(`  Sender  : ${CYAN(short(sender))}`);

  // ── Print decision ───────────────────────────────────────────
  console.log(`\n${BOLD("[ 1 ] Decision")}`);
  console.log(`  Action     : ${GREEN(BOLD("REBALANCE"))}`);
  console.log(`  Source     : ${source.protocol} ${source.tokenA.split("::").pop()}/${source.tokenB.split("::").pop()}  ${YELLOW(source.apy + "% APY")}  ${DIM(short(source.id))}`);
  console.log(`  Target     : ${target.protocol} ${target.tokenA.split("::").pop()}/${target.tokenB.split("::").pop()}  ${GREEN(target.apy + "% APY")}  ${DIM(short(target.id))}`);
  console.log(`  Net gain   : ${GREEN("+" + (target.apy - source.apy).toFixed(1) + "%")}`);
  console.log(`  Amount     : ${DECISION.amountPercent}% of position`);
  console.log(`  Confidence : ${(DECISION.confidence * 100).toFixed(0)}%`);
  console.log(`  Reasoning  : ${DIM(DECISION.reasoning)}`);

  // ── Build PTB ────────────────────────────────────────────────
  console.log(`\n${BOLD("[ 2 ] PTB Structure")}`);
  const needsSwap = source.tokenA !== target.tokenA;
  const steps = needsSwap ? 3 : 2;

  console.log(`  Commands   : ${steps} Move calls  (${needsSwap ? "withdraw → swap → deposit" : "withdraw → deposit"})`);
  console.log(`  Swap step  : ${needsSwap ? YELLOW("yes — tokenA differs") : GREEN("no — same tokenA, direct deposit")}`);
  console.log(`  Gas budget : ${mist(GAS_BUDGET)}`);

  console.log(`\n  ${BOLD("Command 0 — pool::withdraw")}`);
  console.log(`    target         : ${CYAN(`${short(PKG)}::pool::withdraw`)}`);
  console.log(`    typeArguments  : [${source.tokenA.split("::").slice(-2).join("::")}, ${source.tokenB.split("::").slice(-2).join("::")}]`);
  console.log(`    args[0] pool   : ${DIM(short(source.id))}`);
  console.log(`    args[1] amount : ${DECISION.amountPercent}u64`);
  console.log(`    args[2] pos    : ${DIM(short(POSITION_OBJ))}`);
  console.log(`    returns        : Coin<${source.tokenA.split("::").pop()}>`);

  if (needsSwap) {
    console.log(`\n  ${BOLD("Command 1 — swap::swap_exact_input")}`);
    console.log(`    target         : ${CYAN(`${short(PKG)}::swap::swap_exact_input`)}`);
    console.log(`    typeArguments  : [${source.tokenA.split("::").pop()}, ${target.tokenA.split("::").pop()}]`);
    console.log(`    args[0] coin   : Result(0)  ← from withdraw`);
    console.log(`    args[1] min_out: 0u64`);
    console.log(`    returns        : Coin<${target.tokenA.split("::").pop()}>`);
  }

  const depositCmd = needsSwap ? 2 : 1;
  console.log(`\n  ${BOLD(`Command ${depositCmd} — pool::deposit`)}`);
  console.log(`    target         : ${CYAN(`${short(PKG)}::pool::deposit`)}`);
  console.log(`    typeArguments  : [${target.tokenA.split("::").slice(-1)}, ${target.tokenB.split("::").slice(-1)}]`);
  console.log(`    args[0] pool   : ${DIM(short(target.id))}`);
  console.log(`    args[1] coin   : Result(${depositCmd - 1})  ← from ${needsSwap ? "swap" : "withdraw"}`);
  console.log(`    args[2] pos    : ${DIM(short(POSITION_OBJ))}`);

  // ── Build bytes ──────────────────────────────────────────────
  console.log(`\n${BOLD("[ 3 ] Building Transaction Bytes")}`);
  const tx = buildPTB(DECISION, source, target);
  tx.setSender(sender);
  let bytes: Uint8Array;
  try {
    bytes = await tx.build({ client });
    console.log(`  ${GREEN("✓")} Built successfully — ${bytes.length.toLocaleString()} bytes`);
    console.log(`  ${DIM("Base64: " + Buffer.from(bytes).toString("base64").slice(0, 80) + "…")}`);
  } catch (err) {
    console.log(`  ${RED("✗")} Build failed: ${String(err)}`);
    process.exit(1);
  }

  // ── Dry-run ──────────────────────────────────────────────────
  console.log(`\n${BOLD("[ 4 ] Dry-Run Against OneChain Testnet")}`);
  console.log(`  ${YELLOW("⟳")} Submitting to dryRunTransactionBlock…`);
  const t0 = Date.now();

  let dryResult: Awaited<ReturnType<typeof client.dryRunTransactionBlock>>;
  try {
    dryResult = await client.dryRunTransactionBlock({ transactionBlock: bytes });
  } catch (err) {
    console.log(`  ${RED("✗")} RPC error: ${String(err)}`);
    process.exit(1);
  }

  const elapsed = Date.now() - t0;
  const status  = dryResult.effects.status.status;
  const success = status === "success";

  console.log(`  ${success ? GREEN("✓") : RED("✗")} Status   : ${success ? GREEN("success") : RED(status)}`);
  console.log(`  ${DIM("Response time:")} ${elapsed}ms`);

  if (!success && dryResult.effects.status.error) {
    console.log(`  ${RED("Error")}    : ${dryResult.effects.status.error}`);
  }

  // ── Gas breakdown ────────────────────────────────────────────
  console.log(`\n${BOLD("[ 5 ] Gas Breakdown")}`);
  const gas = dryResult.effects.gasUsed;
  const computation = Number(gas.computationCost);
  const storage     = Number(gas.storageCost);
  const rebate      = Number(gas.storageRebate);
  const net         = computation + storage - rebate;

  console.log(`  Computation cost : ${mist(computation)}`);
  console.log(`  Storage cost     : ${mist(storage)}`);
  console.log(`  Storage rebate   : ${mist(rebate)}`);
  console.log(`  ──────────────────────────────────────────`);
  console.log(`  Net gas cost     : ${YELLOW(mist(net))}`);
  console.log(`  Gas budget       : ${mist(GAS_BUDGET)}`);
  console.log(`  Budget used      : ${((net / GAS_BUDGET) * 100).toFixed(1)}%`);

  // ── Object changes ───────────────────────────────────────────
  console.log(`\n${BOLD("[ 6 ] Object Changes")}`);
  const changes = dryResult.effects.mutated ?? [];
  const created = dryResult.effects.created ?? [];

  if (created.length === 0 && changes.length === 0) {
    console.log(`  ${DIM("No object changes recorded")}`);
  }
  created.forEach(obj => {
    const ref = obj.reference;
    console.log(`  ${GREEN("CREATED")}  ${short(ref.objectId)}  v${ref.version}`);
  });
  changes.forEach(obj => {
    const ref = obj.reference;
    console.log(`  ${YELLOW("MUTATED")}  ${short(ref.objectId)}  v${ref.version}`);
  });

  // ── Events ───────────────────────────────────────────────────
  console.log(`\n${BOLD("[ 7 ] Events Emitted")}`);
  const events = dryResult.events ?? [];
  if (events.length === 0) {
    console.log(`  ${DIM("No events emitted")}`);
  } else {
    events.forEach((ev, i) => {
      console.log(`  [${i}] ${CYAN(ev.type.split("::").slice(-1)[0])}`);
      console.log(`      type    : ${DIM(ev.type)}`);
      console.log(`      sender  : ${DIM(ev.sender ? short(ev.sender) : "—")}`);
      console.log(`      payload : ${DIM(JSON.stringify(ev.parsedJson ?? {}).slice(0, 120))}`);
    });
  }

  // ── Final verdict ────────────────────────────────────────────
  console.log(`\n${BOLD("══════════════════════════════════════════════════════════════")}`);
  if (success) {
    console.log(GREEN(BOLD("  ✓ PTB VALID — would execute cleanly on-chain")));
    console.log(GREEN(`    Net cost ${net.toLocaleString()} MIST · digest would be assigned after broadcast`));
  } else {
    console.log(RED(BOLD("  ✗ PTB WOULD FAIL — fix before broadcasting")));
    console.log(RED(`    Error: ${dryResult.effects.status.error ?? "unknown"}`));
  }
  console.log(BOLD("══════════════════════════════════════════════════════════════\n"));
}

main().catch(e => {
  console.error(`\n${RED("Fatal:")} ${e.message}\n`);
  process.exit(1);
});
