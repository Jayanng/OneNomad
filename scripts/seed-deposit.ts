/**
 * Makes an initial deposit of OCT into the first pool so the agent
 * has something to rebalance. Run once before starting the agent.
 *
 * Usage:  npx tsx scripts/seed-deposit.ts
 */

import { SuiClient } from "@onelabs/sui/client";
import { Ed25519Keypair } from "@onelabs/sui/keypairs/ed25519";
import { Transaction } from "@onelabs/sui/transactions";
import * as dotenv from "dotenv";
dotenv.config();

const RPC_URL  = process.env.ONECHAIN_RPC_URL!;
const PKG      = process.env.ONENOMAD_PACKAGE_ID!;
const POOL_ID  = process.env.POOL_OCT_USDC_ID!;
const POS_ID   = process.env.POSITION_OBJECT_ID!;
const OCT      = "0x2::oct::OCT";
const USDC     = `${PKG}::usdc::USDC`;

const client  = new SuiClient({ url: RPC_URL });
const keypair = Ed25519Keypair.fromSecretKey(process.env.PRIVATE_KEY!);
const sender  = keypair.getPublicKey().toSuiAddress();

async function main() {
  console.log(`Sender: ${sender}`);

  // Get OCT coins owned by sender
  const coins = await client.getCoins({ owner: sender, coinType: OCT });
  if (!coins.data.length) throw new Error("No OCT coins found for agent wallet");

  // Deposit 50_000_000 MIST = 0.05 OCT — leave the rest for gas
  const DEPOSIT_AMOUNT = 50_000_000n;

  const tx = new Transaction();
  const [depositCoin] = tx.splitCoins(tx.gas, [DEPOSIT_AMOUNT]);

  tx.moveCall({
    target: `${PKG}::pool::deposit`,
    typeArguments: [OCT, USDC],
    arguments: [
      tx.object(POOL_ID),
      depositCoin,
      tx.object(POS_ID),
    ],
  });

  tx.setGasBudget(10_000_000);

  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true },
  });

  if (result.effects?.status?.status === "success") {
    console.log(`✓ Deposited 0.05 OCT into pool ${POOL_ID}`);
    console.log(`  Digest: ${result.digest}`);
    console.log("\nAgent can now rebalance. Start with: npx tsx src/dashboard.ts");
  } else {
    console.error("✗ Deposit failed:", result.effects?.status?.error);
  }
}

main().catch(console.error);
