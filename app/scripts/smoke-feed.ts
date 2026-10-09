/**
 * End-to-end check on devnet of the real client code: create a Rebyter, claim the ration, feed it,
 * and verify that exactly one meal was burnt and the action was counted for the quests.
 *
 *   SOLANA_WALLET_PATH=../artifacts/private/admin-keypair.json npm run smoke:feed
 */
import { readFile } from "node:fs/promises";
import { Wallet } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { claimDailyRation } from "../src/lib/economy/actions";
import { DEPLOYMENT } from "../src/lib/economy/deployment";
import { playerProfilePda } from "../src/lib/rebyters/config";
import { createRebyter, interactWithRebyter } from "../src/lib/rebyters/companions";
import { getProgram } from "../src/lib/rebyters/registry";
import { gameDay } from "../src/lib/economy/quests";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const walletPath = process.env.SOLANA_WALLET_PATH || "../artifacts/private/admin-keypair.json";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(walletPath, "utf8"))));
  const wallet = new Wallet(signer);
  const retryingFetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    for (let n = 0; ; n++) {
      const res = await fetch(input, init);
      if (res.status !== 429 || n >= 10) return res;
      await pause(2000 * (n + 1));
    }
  };
  const connection = new Connection(rpc, { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: retryingFetch });

  const meatMint = new PublicKey(DEPLOYMENT.foodMints[0]);
  const meatAta = getAssociatedTokenAddressSync(meatMint, signer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const meat = async () => {
    const b = await connection.getTokenAccountBalance(meatAta, "confirmed").catch(() => null);
    return b ? Number(b.value.amount) : 0;
  };
  const counts = async () => {
    const p = await (getProgram(connection).account as any).playerProfile.fetchNullable(playerProfilePda(signer.publicKey), "confirmed");
    return p ? { day: Number(p.questDay), feeds: Number(p.counts[0]), rationDay: Number(p.rationDay) } : null;
  };

  console.log("1. create a Rebyter");
  const created = await createRebyter(connection, wallet as never, wallet, 0);
  console.log("   mint", created.mint);
  await pause(1500);

  console.log("2. claim the daily ration");
  const profile = await counts();
  if (!profile || profile.rationDay < gameDay(Math.floor(Date.now() / 1000))) {
    await claimDailyRation(connection, wallet as never, !!profile);
  } else console.log("   already claimed today");
  await pause(1500);
  const before = await meat();
  const feedsBefore = (await counts())?.feeds ?? 0;
  if (before < 1) throw new Error("No meat after the ration; cannot test feeding");

  console.log(`3. feed meat (have ${before})`);
  await interactWithRebyter(connection, wallet as never, wallet, created.mint, "feed", 0);
  await pause(1500);
  const after = await meat();
  const feedsAfter = (await counts())?.feeds ?? 0;
  console.log(`   meat ${before} -> ${after}, feeds counted ${feedsBefore} -> ${feedsAfter}`);
  if (after !== before - 1) throw new Error("Feeding did not burn exactly one meat");
  if (feedsAfter !== feedsBefore + 1) throw new Error("The feed was not counted for the quests");

  console.log("SMOKE OK");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
