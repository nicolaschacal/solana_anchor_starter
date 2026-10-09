import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createCloseAccountInstruction } from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import type { WorldLayout } from "../../components/world/layout";
import {
  ExtensionType,
  createAssociatedTokenAccountInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMint2Instruction,
  getMintLen,
} from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import { encodeLayout } from "../rebyters/habitat-layout";
import { IRYS_GATEWAY, PROGRAM_ID, habitatAuthorityPda, playerProfilePda } from "../rebyters/config";
import { CATALOG, STARTER_HABITAT_ID, itemIdOf } from "./catalog";
import { getProgram } from "../rebyters/registry";
import { DEPLOYMENT } from "./deployment";
import { budgetIxs } from "./budget";
import { refreshBalances } from "./token";

const enc = new TextEncoder();
export const economyPda = () => PublicKey.findProgramAddressSync([enc.encode("economy3")], PROGRAM_ID)[0];
export const itemTypePda = (itemId: number) => {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, itemId, true);
  return PublicKey.findProgramAddressSync([enc.encode("item3"), bytes], PROGRAM_ID)[0];
};

type Wallet = AnchorWallet;

async function send(connection: Connection, wallet: Wallet, instructions: TransactionInstruction[]) {
  const block = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ ...block, feePayer: wallet.publicKey }).add(...budgetIxs(), ...instructions);
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

/** Saves the layout inside the habitat NFT the wallet holds. */
export async function saveHabitatLayout(connection: Connection, wallet: Wallet, habitatMint: string, layout: WorldLayout) {
  const { placed, props } = encodeLayout(layout);
  const mint = new PublicKey(habitatMint);
  const ix = await getProgram(connection, wallet)
    .methods.setHabitatLayout(placed as never, props as never)
    .accountsStrict({
      owner: wallet.publicKey,
      mint,
      ownerTokenAccount: ata(mint, wallet.publicKey),
      habitatAuthority: habitatAuthorityPda(mint),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();
  return send(connection, wallet, [ix]);
}

/** Chooses which of the wallet's habitats opens with the game. */
export async function selectHabitat(connection: Connection, wallet: Wallet, habitatMint: string) {
  const mint = new PublicKey(habitatMint);
  const ix = await getProgram(connection, wallet)
    .methods.selectHabitat()
    .accountsStrict({
      owner: wallet.publicKey,
      mint,
      ownerTokenAccount: ata(mint, wallet.publicKey),
      playerProfile: playerProfilePda(wallet.publicKey),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .instruction();
  return send(connection, wallet, [ix]);
}

/**
 * Creates a habitat NFT: the mint, the owner's token account and `create_habitat` in one
 * transaction. The free starter habitat (price 0) is claimable once; others burn Gems.
 * The profile is created in the same transaction when missing.
 */
export async function buyHabitat(connection: Connection, wallet: Wallet, catalogId: string) {
  const item = CATALOG.find((i) => i.id === catalogId);
  const itemId = item ? itemIdOf(item) : null;
  if (!item || itemId === null) throw new Error("This habitat is not for sale on this network yet");
  const free = item.price === 0;
  const gemMint = free ? null : need(DEPLOYMENT.gemMint, "Gems");
  const mint = Keypair.generate();
  const authority = habitatAuthorityPda(mint.publicKey);
  const ownerToken = ata(mint.publicKey, wallet.publicKey);
  const mintLen = getMintLen([ExtensionType.MetadataPointer]);
  const mintRent = await connection.getMinimumBalanceForRentExemption(mintLen);
  const program = getProgram(connection, wallet);
  const create = await program.methods
    .createHabitat(itemId, item.name.slice(0, 32), `${IRYS_GATEWAY}/rebyters/habitat/${itemId}.json`)
    .accountsStrict({
      owner: wallet.publicKey,
      playerProfile: playerProfilePda(wallet.publicKey),
      economy: economyPda(),
      itemType: itemTypePda(itemId),
      gemMint: need(DEPLOYMENT.gemMint, "Gems"),
      ownerGemAccount: (gemMint ? ata(gemMint, wallet.publicKey) : null) as never,
      habitatAuthority: authority,
      mint: mint.publicKey,
      ownerTokenAccount: ownerToken,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const block = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ ...block, feePayer: wallet.publicKey }).add(
    ...budgetIxs(600_000),
    ...(await ensureProfileIx(connection, wallet)),
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports: mintRent,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeMetadataPointerInstruction(mint.publicKey, authority, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeMint2Instruction(mint.publicKey, 0, authority, null, TOKEN_2022_PROGRAM_ID),
    createAssociatedTokenAccountInstruction(wallet.publicKey, ownerToken, wallet.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
    create,
  );
  tx.partialSign(mint);
  const signed = await wallet.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
  const result = await connection.confirmTransaction({ ...block, signature }, "confirmed");
  if (result.value.err) throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
  refreshBalances();
  return { signature, mint: mint.publicKey.toBase58() };
}

/** The starter pack: your first habitat and your first meals. Claimable once per wallet. */
export const claimStarterPack = (connection: Connection, wallet: Wallet) => buyHabitat(connection, wallet, STARTER_HABITAT_ID);

/** What closing one empty Token-2022 account gives back (about; the exact deposit is 0.00207408 SOL). */
export const ACCOUNT_RENT_LAMPORTS = 2_074_080;

/** Closes empty token accounts and returns their rent deposit to the wallet. */
export async function reclaimRent(connection: Connection, wallet: Wallet, accounts: PublicKey[]) {
  for (let n = 0; n < accounts.length; n += 12) {
    const batch = accounts.slice(n, n + 12).map((a) => createCloseAccountInstruction(a, wallet.publicKey, wallet.publicKey, [], TOKEN_2022_PROGRAM_ID));
    await send(connection, wallet, batch);
  }
}

/** Burn Gems, receive meals of one food and tier (counters in the profile; nothing is minted). */
export async function buyFood(connection: Connection, wallet: Wallet, foodType: number, tier: number, amount = 1) {
  const gemMint = need(DEPLOYMENT.gemMint, "Gems");
  const ix = await getProgram(connection, wallet)
    .methods.buyFood(foodType, tier, amount)
    .accountsStrict({
      owner: wallet.publicKey,
      economy: economyPda(),
      playerProfile: playerProfilePda(wallet.publicKey),
      gemMint,
      ownerGemAccount: ata(gemMint, wallet.publicKey),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .instruction();
  return send(connection, wallet, [...(await ensureProfileIx(connection, wallet)), ix]);
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
  const claim = await getProgram(connection, wallet)
    .methods.claimDailyRation()
    .accountsStrict({ owner: wallet.publicKey, economy: economyPda(), playerProfile: playerProfilePda(wallet.publicKey) })
    .instruction();
  const ixs: TransactionInstruction[] = [];
  if (!hasDaily) ixs.push(...(await ensureProfileIx(connection, wallet)));
  ixs.push(claim);
  return send(connection, wallet, ixs);
}

export async function claimQuest(connection: Connection, wallet: Wallet, slot: number, hasDaily: boolean) {
  const claim = await getProgram(connection, wallet)
    .methods.claimQuest(slot)
    .accountsStrict({ owner: wallet.publicKey, playerProfile: playerProfilePda(wallet.publicKey) })
    .instruction();
  const ixs = hasDaily ? [claim] : [...(await ensureProfileIx(connection, wallet)), claim];
  return send(connection, wallet, ixs);
}
