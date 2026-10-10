/**
 * Creates the Rebyters economy on devnet and records every address in
 * src/lib/economy/deployment.json (which the game reads). Safe to run again: it only creates what
 * is missing. Needs the admin wallet (registry authority) with devnet SOL.
 *
 *   SOLANA_WALLET_PATH=../artifacts/private/admin-keypair.json npm run setup:economy
 *
 * Habitats are registered here as kinds (price and id); each habitat itself is a 1/1 NFT that a
 * player creates with `create_habitat`. Food is not a token: it is counters in the player profile.
 */
import { readFile, writeFile } from "node:fs/promises";
import { Wallet } from "@anchor-lang/core";
import BN from "bn.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeNonTransferableMintInstruction,
  createInitializePermanentDelegateInstruction,
  getMintLen,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { CATALOG, FOOD_PRICES, registrable } from "../src/lib/economy/catalog";
import { PROPS_BY_SIZE, REBYTERS_BY_SIZE } from "../src/components/world/terrain";
import { fetchActiveFamilyTree } from "../src/lib/rebyters/companions";
import { PROGRAM_ID, registryPda } from "../src/lib/rebyters/config";
import { getProgram } from "../src/lib/rebyters/registry";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const walletPath = process.env.SOLANA_WALLET_PATH || "../artifacts/private/admin-keypair.json";
const deploymentFile = "src/lib/economy/deployment.json";

/** Gem packs sold for SOL (devnet prices; change later with set_gem_pack). */
const GEM_PACKS = [
  { gems: 500, sol: 0.05 },
  { gems: 1200, sol: 0.1 },
  { gems: 3000, sol: 0.22 },
  { gems: 7000, sol: 0.5 },
];
/**
 * Free ration: units of each of the four foods, once per UTC day. Balance note: a Rebyter loses ~2
 * fullness per hour and a meal restores 14-22, so one needs ~2.7 meals a day. 2 of each food = 8 meals,
 * enough to keep the three Rebyters of a 5x5 habitat fed but not to steer their diet or to grow.
 */
const RATION_UNITS = 2;

type Deployment = {
  cluster: "devnet";
  programId: string;
  economy: string;
  treasury: string;
  gemMint: string | null;
  food: { prices: number[] };
  rationUnits: number;
  packs: { id: number; gems: number; priceLamports: number }[];
  items: Record<string, { itemId: number; mint: string | null; evoTarget?: number }>;
};

const enc = new TextEncoder();
const economyPda = PublicKey.findProgramAddressSync([enc.encode("economy3")], PROGRAM_ID)[0];
const itemPda = (id: number) => {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, id, true);
  return PublicKey.findProgramAddressSync([enc.encode("item4"), bytes], PROGRAM_ID)[0];
};

async function loadKeypair(path: string) {
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(path, "utf8"))));
  } catch {
    throw new Error(`Wallet unavailable at ${path}; set SOLANA_WALLET_PATH. No key material is logged.`);
  }
}

async function main() {
  const signer = await loadKeypair(walletPath);
  const wallet = new Wallet(signer);
  // The public devnet endpoint rate-limits hard: retry 429s with a growing pause.
  const retryingFetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    for (let n = 0; ; n++) {
      const res = await fetch(input, init);
      if (res.status !== 429 || n >= 10) return res;
      await new Promise((r) => setTimeout(r, 2000 * (n + 1)));
    }
  };
  const connection = new Connection(rpc, { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: retryingFetch });
  if ((await connection.getGenesisHash()) !== DEVNET_GENESIS) throw new Error("This script only runs on Solana devnet");
  const deployed = await connection.getAccountInfo(PROGRAM_ID);
  if (!deployed?.executable) throw new Error("Program is not deployed; run the deploy action first");
  const program = getProgram(connection, wallet as never);
  const authority = signer.publicKey;

  console.log(`Wallet ${authority.toBase58()} balance ${(await connection.getBalance(authority)) / LAMPORTS_PER_SOL} SOL`);

  let state: Deployment;
  try {
    state = JSON.parse(await readFile(deploymentFile, "utf8"));
  } catch {
    state = {
      cluster: "devnet",
      programId: PROGRAM_ID.toBase58(),
      economy: economyPda.toBase58(),
      treasury: authority.toBase58(),
      gemMint: null,
      food: { prices: [] },
      rationUnits: 0,
      packs: [],
      items: {},
    };
  }
  state.programId = PROGRAM_ID.toBase58();
  state.economy = economyPda.toBase58();
  const save = async () => {
    await writeFile(deploymentFile, JSON.stringify(state, null, 2) + "\n");
    await new Promise((r) => setTimeout(r, 1200));
  };

  const registry = await connection.getAccountInfo(registryPda());
  if (!registry) throw new Error("The registry is not initialized; run publish-sample first");

  /** A Token-2022 mint, 0 decimals, controlled by the economy PDA. */
  async function createMint(opts: { gem?: boolean }) {
    const mint = Keypair.generate();
    const extensions: ExtensionType[] = [];
    if (opts.gem) extensions.push(ExtensionType.NonTransferable);
    if (opts.gem) extensions.push(ExtensionType.PermanentDelegate);
    const space = getMintLen(extensions);
    const lamports = await connection.getMinimumBalanceForRentExemption(space);
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority,
        newAccountPubkey: mint.publicKey,
        space,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
    );
    if (opts.gem) tx.add(createInitializeNonTransferableMintInstruction(mint.publicKey, TOKEN_2022_PROGRAM_ID));
    if (opts.gem) tx.add(createInitializePermanentDelegateInstruction(mint.publicKey, economyPda, TOKEN_2022_PROGRAM_ID));
    tx.add(createInitializeMintInstruction(mint.publicKey, 0, economyPda, null, TOKEN_2022_PROGRAM_ID));
    await sendAndConfirmTransaction(connection, tx, [signer, mint]);
    return mint.publicKey;
  }

  // 1. Economy + Gems. If a previous run died after creating it, recover the Gems mint from chain.
  if ((await connection.getAccountInfo(economyPda)) && !state.gemMint) {
    const existing = await (program.account as any).economy.fetch(economyPda);
    state.gemMint = existing.gemMint.toBase58();
    state.treasury = existing.treasury.toBase58();
    await save();
    console.log("Recovered Gems mint", state.gemMint);
  }
  if (!(await connection.getAccountInfo(economyPda))) {
    const gem = state.gemMint ? new PublicKey(state.gemMint) : await createMint({ gem: true });
    state.gemMint = gem.toBase58();
    await save();
    await program.methods
      .initializeEconomy(new PublicKey(state.treasury))
      .accountsStrict({
        authority,
        registry: registryPda(),
        economy: economyPda,
        gemMint: gem,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Economy initialized, Gems mint", state.gemMint);
  }

  // 2. Gem packs.
  for (const [id, pack] of GEM_PACKS.entries()) {
    const priceLamports = Math.round(pack.sol * LAMPORTS_PER_SOL);
    if (state.packs.some((p) => p.id === id && p.gems === pack.gems && p.priceLamports === priceLamports)) continue;
    await program.methods
      .setGemPack(id, new BN(pack.gems), new BN(priceLamports))
      .accountsStrict({ authority, registry: registryPda(), economy: economyPda })
      .rpc();
    state.packs = [...state.packs.filter((p) => p.id !== id), { id, gems: pack.gems, priceLamports }];
    await save();
    console.log(`Pack ${id}: ${pack.gems} Gems for ${pack.sol} SOL`);
  }

  // 3. Food: the free ration and the price of one meal of every food and tier.
  const economyNow = await (program.account as any).economy.fetch(economyPda);
  const sameFood =
    Number(economyNow.rationUnits) === RATION_UNITS &&
    (economyNow.foodPrices as { toString(): string }[]).every((p, n) => Number(p.toString()) === FOOD_PRICES[n]);
  if (!sameFood) {
    await program.methods
      .setFood(RATION_UNITS, FOOD_PRICES.map((p) => new BN(p)) as never)
      .accountsStrict({ authority, registry: registryPda(), economy: economyPda })
      .rpc();
    console.log(`Food: ration ${RATION_UNITS} plain meals of each; ${FOOD_PRICES.length} prices set`);
  }
  state.food = { prices: FOOD_PRICES };
  state.rationUnits = RATION_UNITS;
  await save();

  // The evolution ids of the active atlas, by key (evolution items name the form they create).
  let evoIds = new Map<string, number>();
  try {
    const family = await fetchActiveFamilyTree(connection, 0);
    evoIds = new Map(family.tree.evolutions.map((e) => [e.key ?? e.name.toLowerCase().replace(/\s+/g, "_"), e.id]));
  } catch (error) {
    console.log("Active atlas unavailable, evolution items are skipped:", error instanceof Error ? error.message : error);
  }

  // 4. Store items: habitat kinds (no mint) and sellable decor and machines (one mint each).
  for (const [index, item] of registrable.entries()) {
    if (state.items[item.id]) continue;
    // Islands get their own id range so they never adopt an old item account from earlier layouts.
    const itemId = item.category === "habitat" ? 200 + index : 100 + index;
    const evoTarget = item.category === "evolution" ? evoIds.get(item.evoKey) : undefined;
    if (item.category === "evolution" && !evoTarget) {
      console.log(`Skipping ${item.id}: no form with key ${item.evoKey} in the active atlas`);
      continue;
    }
    // Created by an earlier run that did not get to save its progress: adopt it.
    if (await connection.getAccountInfo(itemPda(itemId))) {
      const existing = await (program.account as any).itemType.fetch(itemPda(itemId));
      const mint = existing.mint.equals(PublicKey.default) ? null : existing.mint.toBase58();
      state.items[item.id] = { itemId, mint, ...(evoTarget ? { evoTarget } : {}) };
      await save();
      console.log(`Item ${item.id} -> #${itemId} (already on chain)`);
      continue;
    }
    if (item.category === "habitat") {
      await program.methods
        .createHabitatType(itemId, new BN(item.price), REBYTERS_BY_SIZE[item.size], PROPS_BY_SIZE[item.size])
        .accountsStrict({
          authority,
          registry: registryPda(),
          itemType: itemPda(itemId),
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      state.items[item.id] = { itemId, mint: null };
    } else {
      const mint = await createMint({});
      await program.methods
        .createItemType(
          itemId,
          new BN(item.price),
          1,
          item.category === "machine" ? item.training : 255,
          item.category === "machine" ? item.bonusPct : 0,
          evoTarget ?? 0,
        )
        .accountsStrict({
          authority,
          registry: registryPda(),
          economy: economyPda,
          itemType: itemPda(itemId),
          itemMint: mint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      state.items[item.id] = { itemId, mint: mint.toBase58(), ...(evoTarget ? { evoTarget } : {}) };
    }
    await save();
    console.log(`Item ${item.id} -> #${itemId}`);
  }

  // 5. Tuning: bring the prices of decor and machines in line with the catalog.
  for (const item of registrable.filter((i) => i.category !== "habitat")) {
    const entry = state.items[item.id];
    if (!entry) continue;
    const onChain = await (program.account as any).itemType.fetch(itemPda(entry.itemId));
    if (Number(onChain.priceGems) !== item.price || !onChain.active) {
      await program.methods
        .updateItemType(new BN(item.price), true)
        .accountsStrict({ authority, registry: registryPda(), itemType: itemPda(entry.itemId) })
        .rpc();
      console.log(`Price of ${item.id}: ${Number(onChain.priceGems)} -> ${item.price}`);
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  console.log("Economy ready.");
  console.log(JSON.stringify({ gemMint: state.gemMint, items: Object.keys(state.items).length }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
