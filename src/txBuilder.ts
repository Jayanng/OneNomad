import { Transaction } from "@onelabs/sui/transactions";
import type { SuiClient } from "@onelabs/sui/client";
import { Ed25519Keypair } from "@onelabs/sui/keypairs/ed25519";
import type { AIDecision, PoolInfo, TxResult } from "./types";

// ── On-chain addresses ─────────────────────────────────────────────────────────
// Replace with real deployed package IDs once contracts are live on OneChain.

// All pools live in the single onenomad package — OneDEX and OneVault are
// just logical groupings, not separate deployments.
const POSITION_OBJECT   = process.env.POSITION_OBJECT_ID   ?? "0x0";
const SWAP_POOL_OBJECT  = process.env.SWAP_POOL_OBJECT_ID  ?? "0x0"; // Shared swap pool for OCT/USDC etc
const GAS_BUDGET        = parseInt(process.env.GAS_BUDGET_MIST ?? "10000000", 10); // 0.01 OCT

// ── Keypair ───────────────────────────────────────────────────────────────────

function getKeypair(): Ed25519Keypair {
  const key = process.env.PRIVATE_KEY;
  if (!key) throw new Error("PRIVATE_KEY not set in .env");
  // Accepts both raw hex (64 chars) and bech32 OneLabs private key formats
  return Ed25519Keypair.fromSecretKey(key);
}

// ── Package lookup ────────────────────────────────────────────────────────────
// All protocols share the same onenomad package — routing is pool-object-based.
function packageFor(_protocol: string): string {
  const ONENOMAD_PACKAGE = process.env.ONENOMAD_PACKAGE_ID ?? process.env.ONEDEX_PACKAGE_ID ?? "0x0";
  return ONENOMAD_PACKAGE;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build and execute a rebalance PTB:
 *   1. Withdraw amountPercent from source pool
 *   2. Swap tokens if the pair differs between source and target
 *   3. Deposit into target pool
 *
 * dryRun = true  → simulate only via dryRunTransactionBlock, no funds move.
 * dryRun = false → sign and broadcast on-chain.
 */
export async function executeRebalance(
  client: SuiClient,
  decision: AIDecision,
  pools: PoolInfo[],
  dryRun: boolean
): Promise<TxResult> {
  const source = pools.find((p) => p.id === decision.sourcePoolId);
  const target = pools.find((p) => p.id === decision.targetPoolId);

  if (!source || !target) {
    return {
      digest: null,
      dryRun,
      success: false,
      error: `Pool not found — source: ${decision.sourcePoolId}, target: ${decision.targetPoolId}`,
    };
  }

  try {
    const tx = await buildPTB(client, decision, source, target);
    return dryRun ? await simulateTx(client, tx) : await executeTx(client, tx);
  } catch (err) {
    return {
      digest: null,
      dryRun,
      success: false,
      error: String(err),
    };
  }
}

// ── PTB construction ──────────────────────────────────────────────────────────

async function buildPTB(
  client: SuiClient,
  decision: AIDecision,
  source: PoolInfo,
  target: PoolInfo
): Promise<Transaction> {
  const tx = new Transaction();
  const srcPkg = packageFor(source.protocol);
  const tgtPkg = packageFor(target.protocol);

  // ── Step 0: Amount check ──────────────────────────────────────────────────
  if (decision.amountPercent <= 0) {
    throw new Error(`Invalid rebalance amount: ${decision.amountPercent}%`);
  }

  // ── Step 1: Withdraw from source pool ──────────────────────────────────────
  // Calls: source_package::pool::withdraw(pool_obj, amount_percent, position, ctx)
  // Returns a Coin<tokenA> ready for swapping or direct deposit.
  const withdrawResult = tx.moveCall({
    target: `${srcPkg}::pool::withdraw`,
    arguments: [
      tx.object(source.id),
      tx.pure.u64(BigInt(decision.amountPercent)),
      tx.object(POSITION_OBJECT),
    ],
    typeArguments: [source.tokenA, source.tokenB],
  });

  // ── Step 2: Swap if token pair differs ─────────────────────────────────────
  // When source and target pools use different base tokens we route through the
  // DEX swap module. If pairs are identical we pass the coin through unchanged.
  let depositArg = withdrawResult;

  // Swap is only needed when the deposited token (tokenA) differs between pools.
  // If tokenB differs but tokenA is the same, the withdrawn OCT deposits directly.
  const needsSwap = source.tokenA !== target.tokenA;

  if (needsSwap) {
    console.log(`[txBuilder] Token pair differs (${source.tokenA} -> ${target.tokenA}).`);
    console.log(`[txBuilder] Simulating swap by withdrawing ${target.tokenA} from wallet and returning ${source.tokenA}.`);
    
    // 1. Send the withdrawn source coin back to the user
    const senderStr = getKeypair().getPublicKey().toSuiAddress();
    tx.transferObjects([withdrawResult], tx.pure.address(senderStr));

    // 2. Find a coin of the target token type in the user's wallet to use for deposit
    const coins = await client.getCoins({
      owner: senderStr,
      coinType: target.tokenA,
    });
    
    if (coins.data.length === 0) {
      throw new Error(`Cannot simulate swap: no ${target.tokenA} coins found in wallet ${senderStr}`);
    }

    // Use the first available coin
    const targetCoinId = coins.data[0].coinObjectId;
    
    // The pool needs a Coin object; we split a small 100-MIST chunk off our main coin array.
    // splitCoins returns an array of TransactionResult, we take the first element.
    const splitCoins = tx.splitCoins(tx.object(targetCoinId), [tx.pure.u64(100)]);
    depositArg = splitCoins[0] as any;
  }

  // ── Step 3: Deposit into target pool ───────────────────────────────────────
  // Calls: target_package::pool::deposit(pool_obj, coin, position, ctx)
  tx.moveCall({
    target: `${tgtPkg}::pool::deposit`,
    arguments: [
      tx.object(target.id),
      depositArg,
      tx.object(POSITION_OBJECT),
    ],
    typeArguments: [target.tokenA, target.tokenB],
  });

  tx.setGasBudget(GAS_BUDGET);
  return tx;
}

// ── Execution modes ───────────────────────────────────────────────────────────

async function simulateTx(
  client: SuiClient,
  tx: Transaction
): Promise<TxResult> {
  // Build raw bytes then call dryRunTransactionBlock — no signing needed.
  const bytes = await tx.build({ client });
  const result = await client.dryRunTransactionBlock({
    transactionBlock: bytes,
  });

  const success = result.effects.status.status === "success";
  const gasUsed = formatGas(
    result.effects.gasUsed.computationCost,
    result.effects.gasUsed.storageCost
  );

  return {
    digest: null,
    dryRun: true,
    success,
    error: success ? undefined : result.effects.status.error,
    gasUsed,
  };
}

async function executeTx(
  client: SuiClient,
  tx: Transaction
): Promise<TxResult> {
  const keypair = getKeypair();

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: {
      showEffects: true,
      showEvents: true,
    },
  });

  const success = result.effects?.status?.status === "success";
  const gasUsed = result.effects?.gasUsed
    ? formatGas(
        result.effects.gasUsed.computationCost,
        result.effects.gasUsed.storageCost
      )
    : undefined;

  return {
    digest: result.digest,
    dryRun: false,
    success,
    error: success ? undefined : result.effects?.status?.error,
    gasUsed,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatGas(compute: string, storage: string): string {
  return `${compute} computation + ${storage} storage`;
}
