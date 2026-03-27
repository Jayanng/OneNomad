// FILE: scripts/verify-contract.ts
// Queries the deployed onenomad package and all associated objects on OneChain testnet
// Run: npx ts-node scripts/verify-contract.ts

import "dotenv/config";
import { SuiClient } from "@onelabs/sui/client";

const RPC_URL = process.env.ONECHAIN_RPC_URL ?? "https://rpc-testnet.onelabs.cc:443";

const OBJECTS = {
  // Package
  "Package (onenomad)":       process.env.ONENOMAD_PACKAGE_ID!,
  // Admin caps
  "PoolAdminCap":             process.env.POOL_ADMIN_CAP_ID!,
  "SwapAdminCap":             process.env.SWAP_ADMIN_CAP_ID!,
  "USDC TreasuryCap":         process.env.USDC_TREASURY_CAP_ID!,
  "USDT TreasuryCap":         process.env.USDT_TREASURY_CAP_ID!,
  // Position
  "Position (shared)":        process.env.POSITION_OBJECT_ID!,
  // Pools
  "Pool OCT/USDC":            process.env.POOL_OCT_USDC_ID!,
  "Pool OCT/USDT":            process.env.POOL_OCT_USDT_ID!,
  "Pool USDC/USDT":           process.env.POOL_USDC_USDT_ID!,
  "Pool Vault Stable":        process.env.POOL_VAULT_STABLE_ID!,
  "Pool Vault High":          process.env.POOL_VAULT_HIGH_ID!,
};

const PUBLISH_TX = "FrWYJ8zt6QPpLzafWahVJGaRUNGSTGCgL6uGJrPBA7S5";

// ── Colour helpers ────────────────────────────────────────────
const GREEN  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const RED    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const CYAN   = (s: string) => `\x1b[36m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const BOLD   = (s: string) => `\x1b[1m${s}\x1b[0m`;

function tick(ok: boolean) { return ok ? GREEN("✓") : RED("✗"); }
function short(id: string)  { return `${id.slice(0, 10)}…${id.slice(-6)}`; }

async function main() {
  const client = new SuiClient({ url: RPC_URL });

  console.log(`\n${BOLD("═══════════════════════════════════════════════════════")}`);
  console.log(`${BOLD("  OneNomad — On-Chain Contract Verification")}`);
  console.log(`${BOLD("═══════════════════════════════════════════════════════")}`);
  console.log(`  RPC    : ${CYAN(RPC_URL)}`);
  console.log(`  Tx     : ${CYAN(PUBLISH_TX)}`);
  console.log();

  let allPassed = true;

  // ── 1. Verify publish transaction ────────────────────────────
  console.log(BOLD("[ 1 ] Publish Transaction"));
  try {
    const tx = await client.getTransactionBlock({
      digest: PUBLISH_TX,
      options: { showEffects: true, showInput: true },
    });
    const status = tx.effects?.status?.status;
    const ok = status === "success";
    if (!ok) allPassed = false;
    console.log(`  ${tick(ok)} Status   : ${ok ? GREEN("success") : RED(status ?? "unknown")}`);
    console.log(`  ${tick(true)} Digest   : ${CYAN(PUBLISH_TX)}`);
    console.log(`  ${tick(true)} Epoch    : ${tx.effects?.executedEpoch ?? "—"}`);
    console.log(`  ${tick(true)} Gas Used : ${tx.effects?.gasUsed?.computationCost ?? "—"} MIST`);
  } catch (e: unknown) {
    allPassed = false;
    console.log(`  ${RED("✗")} Could not fetch tx: ${(e as Error).message}`);
  }
  console.log();

  // ── 2. Verify package modules ────────────────────────────────
  console.log(BOLD("[ 2 ] Package Modules"));
  const pkgId = process.env.ONENOMAD_PACKAGE_ID!;
  try {
    const pkg = await client.getObject({
      id: pkgId,
      options: { showContent: true, showType: true },
    });
    const data = pkg.data;
    const isPkg = data?.content?.dataType === "package";
    if (!isPkg) allPassed = false;
    console.log(`  ${tick(isPkg)} Type     : ${isPkg ? GREEN("package") : RED(data?.content?.dataType ?? "unknown")}`);
    if (isPkg && data?.content?.dataType === "package") {
      const modules = Object.keys((data.content as { disassembled?: Record<string,unknown> }).disassembled ?? {});
      const expected = ["pool", "position", "swap", "usdc", "usdt"];
      expected.forEach(mod => {
        const found = modules.includes(mod);
        if (!found) allPassed = false;
        console.log(`  ${tick(found)} Module   : ${found ? GREEN(mod) : RED(`${mod} — MISSING`)}`);
      });
    }
  } catch (e: unknown) {
    allPassed = false;
    console.log(`  ${RED("✗")} Could not fetch package: ${(e as Error).message}`);
  }
  console.log();

  // ── 3. Verify all objects ────────────────────────────────────
  console.log(BOLD("[ 3 ] Object Verification"));
  const entries = Object.entries(OBJECTS);
  const results = await Promise.allSettled(
    entries.map(([, id]) =>
      client.getObject({ id, options: { showType: true, showOwner: true } })
    )
  );

  const labelWidth = Math.max(...entries.map(([label]) => label.length));

  for (let i = 0; i < entries.length; i++) {
    const [label, id] = entries[i];
    const result = results[i];
    const pad = label.padEnd(labelWidth);

    if (result.status === "rejected") {
      allPassed = false;
      console.log(`  ${RED("✗")} ${pad}  ${RED("RPC error")}  ${short(id)}`);
      continue;
    }

    const obj = result.value;
    if (obj.error || !obj.data) {
      allPassed = false;
      const reason = obj.error?.code ?? "not found";
      console.log(`  ${RED("✗")} ${pad}  ${RED(reason)}  ${short(id)}`);
      continue;
    }

    const owner = obj.data.owner;
    let ownerLabel = "—";
    if (!owner)                                                      ownerLabel = "—";
    else if (owner === "Immutable")                                  ownerLabel = "Immutable";
    else if (typeof owner === "object" && "Shared" in owner)        ownerLabel = "Shared";
    else if (typeof owner === "object" && "AddressOwner" in owner)  ownerLabel = `Owned(${short((owner as {AddressOwner: string}).AddressOwner)})`;

    const typeStr = label === "Package (onenomad)"
      ? "package"
      : (obj.data.content as {type?: string} | undefined)?.type?.split("::").slice(-2).join("::") ?? obj.data.type ?? "—";

    console.log(`  ${GREEN("✓")} ${pad}  ${YELLOW(ownerLabel.padEnd(12))}  ${CYAN(short(id))}  ${typeStr}`);
  }
  console.log();

  // ── 4. Summary ───────────────────────────────────────────────
  console.log(BOLD("═══════════════════════════════════════════════════════"));
  if (allPassed) {
    console.log(GREEN(BOLD("  ✓ ALL CHECKS PASSED — Contract is live on OneChain testnet")));
  } else {
    console.log(RED(BOLD("  ✗ SOME CHECKS FAILED — See above for details")));
  }
  console.log(BOLD("═══════════════════════════════════════════════════════\n"));

  process.exit(allPassed ? 0 : 1);
}

main().catch(e => {
  console.error(RED(`Fatal: ${e.message}`));
  process.exit(1);
});
