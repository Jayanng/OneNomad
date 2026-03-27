import { SuiClient } from "@onelabs/sui/client";
import { Ed25519Keypair } from "@onelabs/sui/keypairs/ed25519";
import { Transaction } from "@onelabs/sui/transactions";
import * as dotenv from "dotenv";

dotenv.config();

const RPC_URL   = process.env.ONECHAIN_RPC_URL ?? "https://rpc-testnet.onelabs.cc:443";
const client    = new SuiClient({ url: RPC_URL });
const keypair   = Ed25519Keypair.fromSecretKey(process.env.PRIVATE_KEY!);
const sender    = keypair.getPublicKey().toSuiAddress();

const PKG = process.env.ONENOMAD_PACKAGE_ID!;
const USDC_TREASURY_CAP = process.env.USDC_TREASURY_CAP_ID!;
const USDT_TREASURY_CAP = process.env.USDT_TREASURY_CAP_ID!;

async function main() {
  console.log(`\nSender: ${sender}`);
  console.log(`Minting 10,000 USDC and 10,000 USDT to agent wallet...\n`);

  const tx = new Transaction();

  // Mint 10,000 USDC
  tx.moveCall({
    target: `0x2::coin::mint_and_transfer`,
    typeArguments: [`${PKG}::usdc::USDC`],
    arguments: [
      tx.object(USDC_TREASURY_CAP),
      tx.pure.u64(10000_000_000), // 10k with 6 decimals (or 9, just using a large u64)
      tx.pure.address(sender),
    ],
  });

  // Mint 10,000 USDT
  tx.moveCall({
    target: `0x2::coin::mint_and_transfer`,
    typeArguments: [`${PKG}::usdt::USDT`],
    arguments: [
      tx.object(USDT_TREASURY_CAP),
      tx.pure.u64(10000_000_000),
      tx.pure.address(sender),
    ],
  });

  console.log("Submitting mint transaction...");
  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true },
  });

  if (result.effects?.status?.status === "success") {
    console.log(`✓ Mint successful! Digest: ${result.digest}`);
  } else {
    console.error(`✗ Mint failed:`, result.effects?.status?.error);
  }
}

main().catch(console.error);
