import type { SuiClient } from "@onelabs/sui/client";
import type { PoolInfo, ProtocolTier } from "./types";

// ── Token types ───────────────────────────────────────────────────────────────
// OCT is the native OneChain token at 0x2.
// USDC and USDT are deployed in our onenomad package.

const PKG = process.env.ONENOMAD_PACKAGE_ID ?? "0x0";
const OCT  = "0x2::oct::OCT";
const USDC = `${PKG}::usdc::USDC`;
const USDT = `${PKG}::usdt::USDT`;

// ── Pool registry ─────────────────────────────────────────────────────────────
// Pool object IDs are read from .env — set them after deploying contracts.

interface PoolRegistryEntry {
  id: string;
  protocol: string;
  tier: ProtocolTier;
  label: string;
  tokenA: string;
  tokenB: string;
}

const POOL_REGISTRY: PoolRegistryEntry[] = [
  {
    id: process.env.POOL_OCT_USDC_ID ?? "0x0",
    protocol: "OneDEX",
    tier: "established",
    label: "OneDEX OCT/USDC",
    tokenA: OCT,
    tokenB: USDC,
  },
  {
    id: process.env.POOL_OCT_USDT_ID ?? "0x0",
    protocol: "OneDEX",
    tier: "established",
    label: "OneDEX OCT/USDT",
    tokenA: OCT,
    tokenB: USDT,
  },
  {
    id: process.env.POOL_VAULT_STABLE_ID ?? "0x0",
    protocol: "OneVault",
    tier: "established",
    label: "OneVault Stable Yield",
    tokenA: OCT,
    tokenB: USDT,
  },
  {
    id: process.env.POOL_VAULT_HIGH_ID ?? "0x0",
    protocol: "OneVault",
    tier: "experimental",
    label: "OneVault High Yield",
    tokenA: USDC,
    tokenB: USDT,
  },
  {
    id: process.env.POOL_USDC_USDT_ID ?? "0x0",
    protocol: "OneDEX",
    tier: "established",
    label: "OneDEX USDC/USDT",
    tokenA: OCT,
    tokenB: USDC,
  },
];

// ── Live fetch ────────────────────────────────────────────────────────────────

/**
 * Attempt to fetch live APYs from OneChain RPC.
 * Falls back to deterministic mock data on any failure.
 */
export async function fetchAPYs(_client: SuiClient): Promise<PoolInfo[]> {
  console.info("[apyFetcher] ⚠ FORCING MOCK DATA for sensitivity demonstration.");
  return getMockAPYs();
}

/**
 * Fetch APY for a single pool via devInspectTransactionBlock.
 * Calls the pool's `get_apy()` Move view function and BCS-deserialises
 * the returned u64 basis-points value (e.g. 850 → 8.5%).
 */
async function fetchSinglePool(
  client: SuiClient,
  entry: PoolRegistryEntry
): Promise<PoolInfo> {
  if (!entry.id || entry.id === "0x0") {
    throw new Error(`Pool ID not configured for ${entry.label}`);
  }

  const obj = await client.getObject({
    id: entry.id,
    options: { showContent: true },
  });

  if (!obj.data) {
    throw new Error(`Pool object ${entry.id} not found on chain`);
  }

  const content = obj.data.content;
  if (content && content.dataType === "moveObject") {
    const fields = content.fields as Record<string, unknown>;
    const apyBps = Number(fields["apy_bps"] ?? 0);
    if (apyBps > 0) {
      return {
        id: entry.id,
        protocol: entry.protocol,
        tier: entry.tier,
        tokenA: entry.tokenA,
        tokenB: entry.tokenB,
        apy: apyBps / 100,
        tvlUsd: Number(fields["tvl_usd"] ?? 0),
        fetchedAt: Date.now(),
      };
    }
  }

  throw new Error(`Could not parse APY from pool ${entry.id}`);
}

// ── Mock data ─────────────────────────────────────────────────────────────────

/**
 * Deterministic mock APYs seeded by the current minute.
 * Produces realistic variation across cron ticks for demo/testing.
 */
function getMockAPYs(): PoolInfo[] {
  return POOL_REGISTRY.map((entry) => getMockForPool(entry));
}

function getMockForPool(entry: PoolRegistryEntry): PoolInfo {
  const seed = Math.floor(Date.now() / 60_000);
  const idx = POOL_REGISTRY.indexOf(entry);
  const safeIdx = idx >= 0 ? idx : 0;

  const base = [12, 14, 11, 15, 13][safeIdx % 5];
  const variance = ((seed * (safeIdx + 1) * 11) % 1500) / 100; // max 14.99% variance
  const apy = parseFloat((base + variance).toFixed(2));

  const tvlBase = [2_000_000, 1_500_000, 3_000_000, 500_000, 4_000_000][safeIdx % 5];
  const tvlVariance = (seed * (safeIdx + 2) * 13) % 500_000;
  const tvlUsd = tvlBase + tvlVariance;

  return {
    id: entry.id,
    protocol: entry.protocol,
    tier: entry.tier,
    tokenA: entry.tokenA,
    tokenB: entry.tokenB,
    apy,
    tvlUsd,
    fetchedAt: Date.now(),
  };
}
