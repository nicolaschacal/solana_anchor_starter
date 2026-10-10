/**
 * End-to-end check on devnet of the real client code: create a Rebyter, claim the ration, feed it,
 * and verify that exactly one meal was used up and the action was counted for the quests.
 *
 *   SOLANA_WALLET_PATH=../artifacts/private/admin-keypair.json npm run smoke:feed
 */
import { readFile } from "node:fs/promises";
import { Wallet } from "@anchor-lang/core";
import { Connection, Keypair } from "@solana/web3.js";
import { claimDailyRation, saveIslandLayout } from "../src/lib/economy/actions";
import { fetchProfileState } from "../src/lib/economy/profile";
import { playerProfilePda } from "../src/lib/rebyters/config";
import { createRebyter, interactWithRebyter } from "../src/lib/rebyters/companions";
import { getProgram } from "../src/lib/rebyters/registry";
import { gameDay } from "../src/lib/economy/quests";

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

  const profileState = async () => {
    const p = await (getProgram(connection).account as any).playerProfile.fetchNullable(playerProfilePda(signer.publicKey), "confirmed");
    return p
      ? { feeds: Number(p.counts[0]), rationDay: Number(p.rationDay), questDay: Number(p.questDay), meat: Number(p.food[0]), starter: !!p.starterClaimed }
      : null;
  };
  const counts = profileState;
  const meat = async () => (await profileState())?.meat ?? 0;

  console.log("1. create a Rebyter");
  const created = await createRebyter(connection, wallet as never, wallet, 0);
  console.log("   mint", created.mint);
  await pause(1500);
  const start = await profileState();
  if (!start?.starter) throw new Error("The starter pack was not claimed");
  console.log("   starter pack claimed with", start.meat, "meat to start");

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
  if (after !== before - 1) throw new Error("Feeding did not use up exactly one meat");
  if (feedsAfter !== feedsBefore + 1) throw new Error("The feed was not counted for the quests");

  console.log("4. save the island layout in the profile and read it back");
  const layout = {
    v: 1 as const,
    placed: [{ mint: created.mint, i: 18, j: 30 }],
    props: [
      { key: "pine" as const, x: -13.25, z: -25.5, h: 1.8, r: 1.0 },
      { key: "lantern" as const, x: -12, z: -24.75, h: 0.9, r: 2.5 },
    ],
  };
  await saveIslandLayout(connection, wallet as never, layout);
  await pause(1500);
  const read = (await fetchProfileState(connection, signer.publicKey))?.layout;
  if (!read) throw new Error("The saved layout was not found in the profile");
  if (read.placed[0]?.mint !== created.mint || read.props?.length !== 2 || read.props[0].key !== "pine" || read.props[1].key !== "lantern")
    throw new Error("The layout read back does not match what was saved: " + JSON.stringify(read));
  console.log("   layout round-trips through the profile");
  console.log("SMOKE OK");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
