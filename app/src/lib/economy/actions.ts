import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { PROGRAM_ID, playerProfilePda } from "../rebyters/config";
import { getProgram } from "../rebyters/registry";
import { DEPLOYMENT } from "./deployment";
import { refreshBalances } from "./token";

const enc = new TextEncoder();
export const economyPda = () => PublicKey.findProgramAddressSync([enc.encode("economy")], PROGRAM_ID)[0];
export const itemTypePda = (itemId: number) => {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, itemId, true);
  return PublicKey.findProgramAddressSync([enc.encode("item"), bytes], PROGRAM_ID)[0];
};

type Wallet = AnchorWallet;

async function send(connection: Connection, wallet: Wallet, instructions: TransactionInstruction[]) {
  const block = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ ...block, feePayer: wallet.publicKey }).add(...instructions);
  const signed = await wallet.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
  const result = await connection.confirmTransaction({ ...block, signature }, "confirmed");
  if (result.value.err) throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
  refreshBalances();
  return signature;
}

const ata = (mint: PublicKey, owner: PublicKey) =>
  PublicKey.findProgramAddressSync([owner.toBytes(), TOKEN_2022_PROGRAM_ID.toBytes(), mint.toBytes()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];

const need = (value: string | null | undefined, what: string) => {
  if (!value) throw new Error(`${what} is not set up on this network yet`);
  return new PublicKey(value);
};

/** Pay SOL, receive Gems (pack ids come from deployment.json). */
export async function buyGems(connection: Connection, wallet: Wallet, packId: number) {
  const gemMint = need(DEPLOYMENT.gemMint, "Gems");
  const ix = await getProgram(connection, wallet)
    .methods.buyGems(packId)
    .accountsStrict({
      owner: wallet.publicKey,
      economy: economyPda(),
      treasury: new PublicKey(DEPLOYMENT.treasury),
      gemMint,
      ownerGemAccount: ata(gemMint, wallet.publicKey),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return send(connection, wallet, [ix]);
}

/** Burn Gems, receive the item (or a pack of it). */
export async function buyItem(connection: Connection, wallet: Wallet, itemId: number, itemMint: string, quantity = 1) {
  const gemMint = need(DEPLOYMENT.gemMint, "Gems");
  const mint = new PublicKey(itemMint);
  const ix = await getProgram(connection, wallet)
    .methods.buyItem(quantity)
    .accountsStrict({
      owner: wallet.publicKey,
      economy: economyPda(),
      itemType: itemTypePda(itemId),
      gemMint,
      ownerGemAccount: ata(gemMint, wallet.publicKey),
      itemMint: mint,
      ownerItemAccount: ata(mint, wallet.publicKey),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return send(connection, wallet, [ix]);
}

/**
 * The wallet's single profile account (pokedex + daily ration/quest state). Creates it when it does not
 * exist yet, which also covers wallets that only had a legacy profile; returns [] otherwise.
 */
export async function ensureProfileIx(connection: Connection, wallet: Wallet): Promise<TransactionInstruction[]> {
  if (await connection.getAccountInfo(playerProfilePda(wallet.publicKey), "confirmed")) return [];
  return [
    await getProgram(connection, wallet)
      .methods.initializePlayer()
      .accountsStrict({ owner: wallet.publicKey, playerProfile: playerProfilePda(wallet.publicKey), systemProgram: SystemProgram.programId })
      .instruction(),
  ];
}

export async function claimDailyRation(connection: Connection, wallet: Wallet, hasDaily: boolean) {
  const mints = DEPLOYMENT.foodMints.map((m) => new PublicKey(m));
  if (mints.length !== 4) throw new Error("The daily ration is not set up on this network yet");
  const owner = wallet.publicKey;
  const claim = await getProgram(connection, wallet)
    .methods.claimDailyRation()
    .accountsStrict({
      owner,
      economy: economyPda(),
      playerProfile: playerProfilePda(owner),
      meatMint: mints[0],
      plantMint: mints[1],
      fishMint: mints[2],
      fruitMint: mints[3],
      ownerMeat: ata(mints[0], owner),
      ownerPlant: ata(mints[1], owner),
      ownerFish: ata(mints[2], owner),
      ownerFruit: ata(mints[3], owner),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })];
  if (!hasDaily) ixs.push(...(await ensureProfileIx(connection, wallet)));
  ixs.push(claim);
  return send(connection, wallet, ixs);
}

export async function claimQuest(connection: Connection, wallet: Wallet, slot: number, hasDaily: boolean) {
  const spark = need(DEPLOYMENT.sparkMint, "Sparks");
  const claim = await getProgram(connection, wallet)
    .methods.claimQuest(slot)
    .accountsStrict({
      owner: wallet.publicKey,
      economy: economyPda(),
      playerProfile: playerProfilePda(wallet.publicKey),
      sparkMint: spark,
      ownerSparkAccount: ata(spark, wallet.publicKey),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const ixs = hasDaily ? [claim] : [...(await ensureProfileIx(connection, wallet)), claim];
  return send(connection, wallet, ixs);
}

