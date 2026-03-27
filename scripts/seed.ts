import { SuiClient, getFullnodeUrl } from "@onelabs/sui/client";
import { Ed25519Keypair } from "@onelabs/sui/keypairs/ed25519";
import { Transaction } from "@onelabs/sui/transactions";
import * as dotenv from "dotenv";

dotenv.config();

const RPC_URL   = process.env.ONECHAIN_RPC_URL ?? "https://rpc-testnet.onelabs.cc:443";
const client    = new SuiClient({ url: RPC_URL });
const keypair   = Ed25519Keypair.fromSecretKey(process.env.PRIVATE_KEY!);
const sender    = keypair.getPublicKey().toSuiAddress();

// Config from .env
const PKG             = process.env.ONENOMAD_PACKAGE_ID!;
const POSITION_OBJ    = process.env.POSITION_OBJECT_ID!;
const TARGET_POOL_ID  = process.env.POOL_OCT_USDC_ID!;

async function main() {
  console.log(`\nSender: ${sender}`);
  console.log(`Depositing 1.0 OCT into pool: ${TARGET_POOL_ID}\n`);

  const tx = new Transaction();

  // Split 1.0 OCT for the deposit (1,000,000,000 MIST)
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(1_000_000_000)]);

  // deposit<CoinA, CoinB>(pool, coinA, position, ctx)
  tx.moveCall({
    target: `${PKG}::pool::deposit`,
    typeArguments: ["0x2::oct::OCT", `${PKG}::usdc::USDC`],
    arguments: [
      tx.object(TARGET_POOL_ID),
      coin,
      tx.object(POSITION_OBJ),
    ],
  });

  console.log("Submitting deposit transaction...");
  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true },
  });

  if (result.effects?.status?.status === "success") {
    console.log(`✓ Deposit successful! Digest: ${result.digest}`);
    console.log(`Agent now has 1.0 OCT in the OCT/USDC pool to manage.`);
  } else {
    console.error(`✗ Deposit failed:`, result.effects?.status?.error);
  }
}

main().catch(console.error);
