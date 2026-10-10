/**
 * Measures what the game's actions really cost a player on devnet: a brand-new wallet is funded from
 * the admin wallet, plays through the typical actions with the real client code, and every balance
 * change is split into network fee (lost) and rent (a refundable deposit locked in new accounts).
 * The leftover is sent back. Output is a table.
 *
 *   SOLANA_WALLET_PATH=../artifacts/private/admin-keypair.json npm run cost:report
 */
import { readFile } from "node:fs/promises";
import { Wallet } from "@anchor-lang/core";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { buyFood, buyGems, buyItem, claimDailyRation, claimStarterPack, saveIslandLayout } from "../src/lib/economy/actions";
import { DEPLOYMENT } from "../src/lib/economy/deployment";
import { createRebyter, interactWithRebyter } from "../src/lib/rebyters/companions";

const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const walletPath = process.env.SOLANA_WALLET_PATH || "../artifacts/private/admin-keypair.json";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(6);

async function main() {
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(walletPath, "utf8"))));
  const retryingFetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    for (let n = 0; ; n++) {
      const res = await fetch(input, init);
      if (res.status !== 429 || n >= 10) return res;
      await pause(2000 * (n + 1));
    }
  };
  const connection = new Connection(rpc, { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: retryingFetch });

  const user = Keypair.generate();
  const wallet = new Wallet(user);
  const fund = 0.12 * LAMPORTS_PER_SOL;
  await sendAndConfirmTransaction(connection, new Transaction().add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: user.publicKey, lamports: fund })), [admin]);
  await pause(1500);

  const rows: { label: string; total: number; fee: number }[] = [];
  const measure = async (label: string, job: () => Promise<unknown>) => {
    const before = await connection.getBalance(user.publicKey, "confirmed");
    const result = (await job()) as string | { signature: string };
    const signature = typeof result === "string" ? result : result.signature;
    await pause(1500);
    const after = await connection.getBalance(user.publicKey, "confirmed");
    const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    rows.push({ label, total: before - after, fee: tx?.meta?.fee ?? 0 });
    console.log(`   ${label}: ${sol(before - after)} SOL (fee ${sol(tx?.meta?.fee ?? 0)})`);
  };

  // Buying gems moves real SOL to the treasury; report only what it costs on top of the price.
  const pack = DEPLOYMENT.packs[0];
  let mint = "";
  await measure("starter pack (profile + first meals)", () => claimStarterPack(connection, wallet as never));
  await measure("create first Rebyter (mint)", async () => {
    const created = await createRebyter(connection, wallet as never, wallet, 0);
    mint = created.mint;
    return created;
  });
  await measure("claim daily ration", () => claimDailyRation(connection, wallet as never, true));
  await measure("feed", () => interactWithRebyter(connection, wallet as never, wallet, mint, "feed", 0));
  await measure("feed again", () => interactWithRebyter(connection, wallet as never, wallet, mint, "feed", 4));
  await measure("play", () => interactWithRebyter(connection, wallet as never, wallet, mint, "play", 0));
  await measure("care", () => interactWithRebyter(connection, wallet as never, wallet, mint, "care", 0));
  await measure("train (normal rate, no machine)", () => interactWithRebyter(connection, wallet as never, wallet, mint, "train", 5));
  await measure("rest", () => interactWithRebyter(connection, wallet as never, wallet, mint, "rest", 0));
  await measure("save island layout", () =>
    saveIslandLayout(connection, wallet as never, { v: 1, placed: [{ mint, i: 18, j: 30 }], props: [{ key: "pine", x: -13, z: -25, h: 1.8, r: 1 }] }),
  );
  await measure(`buy Gems (pack 0, price ${sol(pack.priceLamports)} SOL excluded)`, async () => {
    const sig = await buyGems(connection, wallet as never, pack.id);
    return sig;
  });
  await measure("buy one Steak (tier 1) with Gems", () => buyFood(connection, wallet as never, 0, 1));
  const flowers = DEPLOYMENT.items["decor-flowers"];
  await measure("buy a decor item (first time, new account)", () => buyItem(connection, wallet as never, flowers.itemId, flowers.mint!, 1));

  // Send the leftover back.
  const left = await connection.getBalance(user.publicKey, "confirmed");
  if (left > 10_000) {
    await sendAndConfirmTransaction(connection, new Transaction().add(SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: admin.publicKey, lamports: left - 5_000 })), [user]);
  }

  const rent = await Promise.all([165, 170, 313 + 0].map((n) => connection.getMinimumBalanceForRentExemption(n)));
  console.log("\nRESULTS (SOL; 'locked' = rent deposit inside new accounts, not a fee)");
  for (const r of rows) {
    const extra = r.label.startsWith("buy Gems") ? r.total - r.fee - pack.priceLamports : r.total - r.fee;
    console.log(`${r.label.padEnd(58)} total ${sol(r.total)}  fee ${sol(r.fee)}  locked ${sol(Math.max(0, extra))}`);
  }
  console.log(`rent of a 165-byte token account: ${sol(rent[0])}; 170-byte (Token-2022): ${sol(rent[1])}`);
  console.log("COST REPORT OK");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
