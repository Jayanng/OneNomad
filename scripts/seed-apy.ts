// FILE: scripts/seed-apy.ts
// Calls pool::update_apy on each of the 5 pools with realistic APY values.
// One transaction per pool → individual digest per pool for verification on onescan.cc.
// Run: npx ts-node scripts/seed-apy.ts

import "dotenv/config";
import { SuiClient }      from "@onelabs/sui/client";
import { Transaction }    from "@onelabs/sui/transactions";
import { Ed25519Keypair } from "@onelabs/sui/keypairs/ed25519";

// ── Config ─────────────────────────────────────────────────────────────────

const RPC_URL  = process.env.ONECHAIN_RPC_URL ?? "https://rpc-testnet.onelabs.cc:443";
const PKG      = process.env.ONENOMAD_PACKAGE_ID!;
const ADMIN_CAP= process.env.POOL_ADMIN_CAP_ID!;

if (!PKG || PKG === "0x0")  throw new Error("ONENOMAD_PACKAGE_ID not set");
if (!ADMIN_CAP)             throw new Error("POOL_ADMIN_CAP_ID not set in .env");

// ── Keypair ────────────────────────────────────────────────────────────────

function loadKeypair(): Ed25519Keypair {
  const raw = process.env.PRIVATE_KEY ?? "";
  if (raw.startsWith("suiprivkey")) return Ed25519Keypair.fromSecretKey(raw);
  const bytes = Buffer.from(raw.replace("0x", ""), "hex");
  return Ed25519Keypair.fromSecretKey(bytes);
}

// ── Pool definitions ───────────────────────────────────────────────────────
// typeArgs must match the on-chain Pool<A, B> generic parameters exactly.

interface PoolDef {
  name:     string;
  id:       string;
  apyBps:   number;          // basis points: 850 = 8.50%
  typeArgs: [string, string];
}

const OCT   = "0x2::oct::OCT";
const USDC  = `${PKG}::usdc::USDC`;
const USDT  = `${PKG}::usdt::USDT`;

const POOLS: PoolDef[] = [
  {
    name:    "OCT/USDC",
    id:      process.env.POOL_OCT_USDC_ID!,
    apyBps:  850,    // 8.50%
    typeArgs: [OCT, USDC],
  },
  {
    name:    "OCT/USDT",
    id:      process.env.POOL_OCT_USDT_ID!,
    apyBps:  1470,   // 14.70%  ← highest yield pool
    typeArgs: [OCT, USDT],
  },
  {
    name:    "USDC/USDT (stable)",
    id:      process.env.POOL_USDC_USDT_ID!,
    apyBps:  620,    // 6.20%
    typeArgs: [OCT, USDC],   // on-chain type params (as returned by getObject)
  },
  {
    name:    "OneVault Stable",
    id:      process.env.POOL_VAULT_STABLE_ID!,
    apyBps:  920,    // 9.20%
    typeArgs: [OCT, USDT],   // on-chain type params
  },
  {
    name:    "OneVault High",
    id:      process.env.POOL_VAULT_HIGH_ID!,
    apyBps:  1250,   // 12.50%
    typeArgs: [USDC, USDT],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function bpsToDisplay(bps: number): string {
  return (bps / 100).toFixed(2) + "%";
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const client  = new SuiClient({ url: RPC_URL });
  const keypair = loadKeypair();
  const sender  = keypair.toSuiAddress();

  console.log("\n════════════════════════════════════════════════════════════");
  console.log("  OneNomad — Pool APY Seeder");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  Sender  : ${sender}`);
  console.log(`  Package : ${PKG}`);
  console.log(`  AdminCap: ${ADMIN_CAP}`);
  console.log(`  RPC     : ${RPC_URL}`);
  console.log("────────────────────────────────────────────────────────────\n");

  const results: { name: string; apyBps: number; digest: string | null; error: string | null }[] = [];

  for (const pool of POOLS) {
    if (!pool.id || pool.id === "0x0") {
      console.log(`  ⊘  ${pool.name.padEnd(22)} — pool ID not set in .env, skipping`);
      results.push({ name: pool.name, apyBps: pool.apyBps, digest: null, error: "pool ID not set" });
      continue;
    }

    process.stdout.write(`  ⟳  ${pool.name.padEnd(22)} → setting APY to ${bpsToDisplay(pool.apyBps)} … `);

    try {
      const tx = new Transaction();
      tx.setSender(sender);

      tx.moveCall({
        target: `${PKG}::pool::update_apy`,
        typeArguments: pool.typeArgs,
        arguments: [
          tx.object(ADMIN_CAP),
          tx.object(pool.id),
          tx.pure.u64(pool.apyBps),
        ],
      });

      tx.setGasBudget(10_000_000);

      const bytes  = await tx.build({ client });
      const signed = await keypair.signTransaction(bytes);

      const result = await client.executeTransactionBlock({
        transactionBlock: signed.bytes,
        signature:        signed.signature,
        options:          { showEffects: true },
      });

      const status = result.effects?.status?.status;
      const digest = result.digest;

      if (status === "success") {
        console.log(`✓`);
        console.log(`     Digest  : ${digest}`);
        console.log(`     Explorer: https://onescan.cc/testnet/tx/${digest}`);
        results.push({ name: pool.name, apyBps: pool.apyBps, digest, error: null });
      } else {
        const err = result.effects?.status?.error ?? "unknown error";
        console.log(`✗  ${err}`);
        results.push({ name: pool.name, apyBps: pool.apyBps, digest: null, error: err });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗  ${msg.slice(0, 100)}`);
      results.push({ name: pool.name, apyBps: pool.apyBps, digest: null, error: msg.slice(0, 100) });
    }

    console.log();
  }

  // ── Summary table ─────────────────────────────────────────────────────
  console.log("════════════════════════════════════════════════════════════");
  console.log("  Summary");
  console.log("────────────────────────────────────────────────────────────");
  for (const r of results) {
    const status = r.digest ? "✓" : "✗";
    const apy    = bpsToDisplay(r.apyBps).padStart(7);
    const detail = r.digest
      ? `${r.digest.slice(0, 10)}…${r.digest.slice(-8)}`
      : (r.error ?? "skipped");
    console.log(`  ${status}  ${r.name.padEnd(22)}  ${apy}   ${detail}`);
  }
  console.log("════════════════════════════════════════════════════════════\n");

  const ok  = results.filter(r => r.digest).length;
  const err = results.filter(r => !r.digest).length;
  console.log(`  ${ok} succeeded, ${err} failed/skipped\n`);
}

main().catch(e => {
  console.error(`\nFatal: ${e.message}\n`);
  process.exit(1);
});
