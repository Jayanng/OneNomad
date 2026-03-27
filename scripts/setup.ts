/**
 * OneNomad post-deploy setup script.
 * Creates the Position object and all 5 pools, then prints the IDs
 * so you can paste them into .env.
 *
 * Usage:
 *   npx tsx scripts/setup.ts
 */

import { getFullnodeUrl, SuiClient } from "@onelabs/sui/client";
import { Ed25519Keypair } from "@onelabs/sui/keypairs/ed25519";
import { Transaction } from "@onelabs/sui/transactions";
import * as dotenv from "dotenv";

dotenv.config();

const RPC_URL   = process.env.ONECHAIN_RPC_URL ?? "https://rpc-testnet.onelabs.cc:443";
const PKG       = process.env.ONENOMAD_PACKAGE_ID!;
const ADMIN_CAP = process.env.POOL_ADMIN_CAP_ID!;

if (!PKG || PKG === "0x0") throw new Error("ONENOMAD_PACKAGE_ID not set in .env");
if (!ADMIN_CAP || ADMIN_CAP === "0x0") throw new Error("POOL_ADMIN_CAP_ID not set in .env");

const client = new SuiClient({ url: RPC_URL });

const keypair = Ed25519Keypair.fromSecretKey(process.env.PRIVATE_KEY!);
const sender  = keypair.getPublicKey().toSuiAddress();

// Coin types
const OCT        = "0x2::oct::OCT";
const USDC       = `${PKG}::usdc::USDC`;
const USDT       = `${PKG}::usdt::USDT`;

async function setup() {
  console.log(`\nSender: ${sender}`);
  console.log(`Package: ${PKG}\n`);

  const tx = new Transaction();

  // ── 1. Create shared Position object ───────────────────────────────────────
  tx.moveCall({
    target: `${PKG}::position::create_shared`,
    arguments: [],
  });

  // ── 2. Create pools ────────────────────────────────────────────────────────
  // Each pool: create_pool<CoinA, CoinB>(admin_cap, apy_bps, ctx)
  // APYs in basis points: 850 = 8.50%

  // OCT/USDC — 8.50% APY
  tx.moveCall({
    target: `${PKG}::pool::create_pool`,
    typeArguments: [OCT, USDC],
    arguments: [
      tx.object(ADMIN_CAP),
      tx.pure.u64(850),
    ],
  });

  // OCT/USDT — 9.20% APY
  tx.moveCall({
    target: `${PKG}::pool::create_pool`,
    typeArguments: [OCT, USDT],
    arguments: [
      tx.object(ADMIN_CAP),
      tx.pure.u64(920),
    ],
  });

  // USDC/USDT stable — 5.10% APY
  tx.moveCall({
    target: `${PKG}::pool::create_pool`,
    typeArguments: [USDC, USDT],
    arguments: [
      tx.object(ADMIN_CAP),
      tx.pure.u64(510),
    ],
  });

  // Vault Stable (OCT/USDC duplicate with conservative APY) — 6.30% APY
  tx.moveCall({
    target: `${PKG}::pool::create_pool`,
    typeArguments: [OCT, USDC],
    arguments: [
      tx.object(ADMIN_CAP),
      tx.pure.u64(630),
    ],
  });

  // Vault High (OCT/USDT duplicate with aggressive APY) — 14.70% APY
  tx.moveCall({
    target: `${PKG}::pool::create_pool`,
    typeArguments: [OCT, USDT],
    arguments: [
      tx.object(ADMIN_CAP),
      tx.pure.u64(1470),
    ],
  });

  // ── Execute ────────────────────────────────────────────────────────────────
  console.log("Submitting setup transaction...");
  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showObjectChanges: true, showEffects: true },
  });

  if (result.effects?.status?.status !== "success") {
    console.error("Transaction failed:", result.effects?.status);
    process.exit(1);
  }

  console.log(`\nTransaction: ${result.digest}\n`);

  // ── Parse created shared objects ───────────────────────────────────────────
  const created = result.objectChanges?.filter(
    (c: any) => c.type === "created"
  ) ?? [];

  const positionObj = created.find((c: any) =>
    c.objectType?.includes("::position::Position")
  );

  const pools = created.filter((c: any) =>
    c.objectType?.includes("::pool::Pool")
  );

  console.log("========================================");
  console.log("  Paste these into your .env file:");
  console.log("========================================\n");

  if (positionObj) {
    console.log(`POSITION_OBJECT_ID=${(positionObj as any).objectId}`);
  }

  // Pool order matches creation order above
  const labels = [
    "POOL_OCT_USDC_ID",
    "POOL_OCT_USDT_ID",
    "POOL_USDC_USDT_ID",
    "POOL_VAULT_STABLE_ID",
    "POOL_VAULT_HIGH_ID",
  ];

  pools.forEach((pool: any, i: number) => {
    const label = labels[i] ?? `POOL_UNKNOWN_${i}`;
    console.log(`${label}=${pool.objectId}`);
  });

  console.log("\n========================================\n");
}

setup().catch((err) => {
  console.error(err);
  process.exit(1);
});
