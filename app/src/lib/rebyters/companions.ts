import bs58 from "bs58";
import { Buffer } from "buffer";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMint2Instruction,
  getAssociatedTokenAddressSync,
  getMintLen,
  getTokenMetadata,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { hexToBytes } from "@noble/hashes/utils";
import { budgetIxs } from "../economy/budget";
import { claimStarterPack, ensureProfileIx, itemTypePda } from "../economy/actions";
import { itemIdOf, type StoreItem } from "../economy/catalog";
import { DEPLOYMENT } from "../economy/deployment";
import { fetchProfileState } from "../economy/profile";
import { refreshBalances } from "../economy/token";
import {
  PROGRAM_ID,
  playerProfilePda,
  registryPda,
  treePda,
} from "./config";
import { getProgram, fetchRegistry, fetchTree } from "./registry";
import { fetchVerifiedTree } from "./tree";
import { buildMerkleTree, leafHash } from "./merkle";
import type { TreeJson } from "./types";

export interface PlayerProfile {
  owner: string;
  createdAt: number;
  discoveries: number[];
}

export interface OnchainRebyter {
  address: string;
  dnaByteLength: number;
  owner: string;
  mint: string;
  evolutionId: number;
  dnaBase58: string;
  careMistakes: number;
  weight: number;
  bond: number;
  discipline: number;
  fullness: number;
  energy: number;
  condition: number;
  diet: number[];
  timeInteractions: number[];
  cycle: number;
  lastStateAt: number;
  stageEnteredAt: number;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  learnedSkills: bigint;
  metadataUri: string;
}

export function rebyterAuthorityPda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("rebyter_authority"), mint.toBytes()],
    PROGRAM_ID,
  )[0];
}

function metadataMap(
  entries: unknown,
): Map<string, string> {
  if (!Array.isArray(entries)) return new Map();
  return new Map(
    entries
      .filter(
        (entry): entry is [string, string] =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          typeof entry[0] === "string" &&
          typeof entry[1] === "string",
      ),
  );
}

function readU16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}
function readU32(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}
function readU64(bytes: Uint8Array, offset: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
  return view.getBigUint64(0, true);
}

export const REBYTER_CONDITION = {
  tired: 1 << 0,
  overfed: 1 << 1,
  sick: 1 << 2,
  injured: 1 << 3,
} as const;

export function decodeRebyterDnaBytes(value: string) {
  return Uint8Array.from(bs58.decode(value));
}

function decodeDna(value: string) {
  const bytes = decodeRebyterDnaBytes(value);
  if (bytes.length !== 50)
    throw new Error("Unsupported Rebyter DNA: mint a current-generation Rebyter");
  let o = 0;
  const evolutionId = readU16(bytes, o); o += 2;
  const weight = bytes[o++];
  const bond = bytes[o++];
  const discipline = bytes[o++];
  const careMistakes = bytes[o++];
  const fullness = bytes[o++];
  const energy = bytes[o++];
  const condition = bytes[o++];
  const diet = [0,0,0,0].map(()=>{ const v=readU16(bytes,o); o+=2; return v; });
  const timeInteractions = [0,0,0,0].map(()=>{ const v=readU16(bytes,o); o+=2; return v; });
  const cycle = bytes[o++];
  const hp = readU16(bytes,o); o+=2;
  const atk = readU16(bytes,o); o+=2;
  const def = readU16(bytes,o); o+=2;
  const spd = readU16(bytes,o); o+=2;
  const lastStateAt = readU32(bytes,o); o+=4;
  const stageEnteredAt = readU32(bytes,o); o+=4;
  const learnedSkills = readU64(bytes,o);
  return {
    evolutionId, weight, bond, discipline, careMistakes, fullness, energy, condition,
    diet, timeInteractions, cycle, hp, atk, def, spd,
    lastStateAt, stageEnteredAt, learnedSkills,
  };
}

function effectiveDnaState(raw: ReturnType<typeof decodeDna>) {
  const now = Math.floor(Date.now()/1000);
  const hours = Math.max(0,Math.floor((now-raw.lastStateAt)/3600));
  if(!hours) return raw;
  const fullness=Math.max(0,raw.fullness-hours*2);
  const energy=Math.min(100,raw.energy+hours*3);
  let condition=raw.condition;
  let careMistakes=raw.careMistakes;
  if(fullness<=80) condition&=~REBYTER_CONDITION.overfed;
  if(energy>=40) condition&=~REBYTER_CONDITION.tired;
  if(fullness===0&&hours>=12&&(condition&REBYTER_CONDITION.sick)===0){
    condition|=REBYTER_CONDITION.sick;
    careMistakes=Math.min(255,careMistakes+1);
  }
  return {...raw,fullness,energy,condition,careMistakes};
}

export async function fetchPlayerProfile(
  connection: Connection,
  owner: PublicKey,
): Promise<PlayerProfile | null> {
  const account = await (getProgram(connection).account as any).playerProfile.fetchNullable(
    playerProfilePda(owner),
  );
  if (!account) return null;
  return {
    owner: account.owner.toBase58(),
    createdAt: Number(account.createdAt),
    discoveries: Array.from(account.discoveries as number[]),
  };
}

export async function fetchFirstOwnedRebyter(
  connection: Connection,
  owner: PublicKey,
): Promise<OnchainRebyter | null> {
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
    owner,
    { programId: TOKEN_2022_PROGRAM_ID },
    "confirmed",
  );

  for (const record of tokenAccounts.value) {
    const parsed = (record.account.data as any)?.parsed?.info;
    if (
      parsed?.tokenAmount?.amount !== "1" ||
      parsed?.tokenAmount?.decimals !== 0 ||
      !parsed?.mint
    ) continue;

    const mintString = parsed.mint as string;
    const mint = new PublicKey(mintString);
    let metadata;
    try {
      metadata = await getTokenMetadata(
        connection,
        mint,
        "confirmed",
        TOKEN_2022_PROGRAM_ID,
      );
    } catch {
      continue;
    }
    if (!metadata) continue;

    const fields = metadataMap((metadata as any).additionalMetadata);
    const dnaField = fields.get("DNA");
    if (!dnaField) continue;

    let dnaState;
    try {
      dnaState = effectiveDnaState(decodeDna(dnaField));
    } catch {
      continue;
    }

    return {
      address: mintString,
      dnaByteLength: decodeRebyterDnaBytes(dnaField).length,
      owner: owner.toBase58(),
      mint: mintString,
      evolutionId: dnaState.evolutionId,
      dnaBase58: dnaField,
      careMistakes: dnaState.careMistakes,
      weight: dnaState.weight,
      bond: dnaState.bond,
      discipline: dnaState.discipline,
      fullness: dnaState.fullness,
      energy: dnaState.energy,
      condition: dnaState.condition,
      diet: dnaState.diet,
      timeInteractions: dnaState.timeInteractions,
      cycle: dnaState.cycle,
      lastStateAt: dnaState.lastStateAt,
      stageEnteredAt: dnaState.stageEnteredAt,
      hp: dnaState.hp,
      atk: dnaState.atk,
      def: dnaState.def,
      spd: dnaState.spd,
      learnedSkills: dnaState.learnedSkills,
      metadataUri: metadata.uri,
    };
  }

  return null;
}

export async function fetchOwnedRebyters(
  connection: Connection,
  owner: PublicKey,
  onFound?: (rebyter: OnchainRebyter) => void,
): Promise<OnchainRebyter[]> {
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
    owner,
    { programId: TOKEN_2022_PROGRAM_ID },
    "confirmed",
  );

  const mints = new Set<string>();
  for (const record of tokenAccounts.value) {
    const parsed = (record.account.data as any)?.parsed?.info;
    const amount = parsed?.tokenAmount?.amount;
    if (amount === "1" && parsed?.tokenAmount?.decimals === 0 && parsed?.mint)
      mints.add(parsed.mint);
  }

  const mintList = [...mints];
  const decoded: Array<OnchainRebyter | null> = new Array(mintList.length).fill(null);
  let cursor = 0;

  // Token-2022 metadata used to be fetched strictly one mint at a time.
  // A small worker pool dramatically reduces login latency while avoiding a
  // burst large enough to trip public RPC rate limits.
  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= mintList.length) return;
      const mintString = mintList[index];
      const mint = new PublicKey(mintString);
      let metadata;
      try {
        metadata = await getTokenMetadata(
          connection,
          mint,
          "confirmed",
          TOKEN_2022_PROGRAM_ID,
        );
      } catch {
        continue;
      }
      if (!metadata) continue;

      const fields = metadataMap((metadata as any).additionalMetadata);
      const dnaField = fields.get("DNA");
      if (!dnaField) continue;

      let dnaState;
      try {
        dnaState = effectiveDnaState(decodeDna(dnaField));
      } catch {
        continue;
      }

      const rebyter: OnchainRebyter = {
        address: mintString,
        dnaByteLength: decodeRebyterDnaBytes(dnaField).length,
        owner: owner.toBase58(),
        mint: mintString,
        evolutionId: dnaState.evolutionId,
        dnaBase58: dnaField,
        careMistakes: dnaState.careMistakes,
        weight: dnaState.weight,
        bond: dnaState.bond,
        discipline: dnaState.discipline,
        fullness: dnaState.fullness,
        energy: dnaState.energy,
        condition: dnaState.condition,
        diet: dnaState.diet,
        timeInteractions: dnaState.timeInteractions,
        cycle: dnaState.cycle,
        lastStateAt: dnaState.lastStateAt,
        stageEnteredAt: dnaState.stageEnteredAt,
        hp: dnaState.hp,
        atk: dnaState.atk,
        def: dnaState.def,
        spd: dnaState.spd,
        learnedSkills: dnaState.learnedSkills,
        metadataUri: metadata.uri,
      };
      decoded[index] = rebyter;
      onFound?.(rebyter);
    }
  };

  const workers = Math.min(5, mintList.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return decoded.filter((item): item is OnchainRebyter => item !== null);
}

export async function fetchActiveFamilyTree(
  connection: Connection,
  familyId: number,
): Promise<{ tree: TreeJson; version: number }> {
  const registry = await fetchRegistry(connection);
  if (!registry) throw new Error("Rebyters registry is not initialized");
  const version = registry.activeVersions[familyId] ?? 0;
  if (!version) throw new Error("This Rebyter family is not active yet");
  const metadata = await fetchTree(connection, familyId, version);
  if (!metadata) throw new Error("Active evolution tree is missing");
  return { tree: await fetchVerifiedTree(metadata), version };
}

export type RebytersTransactionWallet = {
  publicKey: PublicKey | null;
  signTransaction?: (transaction: Transaction) => Promise<Transaction>;
};

export async function createRebyter(
  connection: Connection,
  anchorWallet: AnchorWallet,
  wallet: RebytersTransactionWallet,
  familyId: number,
) {
  if (familyId !== 0) throw new Error("Only Mammal creation is enabled");
  if (!wallet.publicKey || !wallet.signTransaction)
    throw new Error("Connect a wallet that can sign transactions");

  // First Rebyter of this wallet: the starter pack (profile and first meals) comes first.
  // It is its own transaction because a second mint would not fit next to the evolution proof.
  {
    const state = await fetchProfileState(connection, wallet.publicKey).catch(() => null);
    if (!state?.starterClaimed) await claimStarterPack(connection, anchorWallet);
  }

  const { tree, version } = await fetchActiveFamilyTree(connection, familyId);
  const origin = tree.evolutions.find((e) => e.stage === 0 && e.enabled);
  if (!origin) throw new Error("Active family has no enabled BIT origin");
  const metadataUri = origin.assets?.metadataUri;
  if (!metadataUri?.startsWith("https://"))
    throw new Error(
      "The Mammal BIT reference has not been published to Irys yet. Push its image + metadata from Admin and publish the atlas first.",
    );

  const proof = buildMerkleTree(tree).getEvolutionProof(origin.id);
  const evolutionLeafHash = [...hexToBytes(leafHash(tree, origin))];
  const siblings = proof.siblings.map((hash) => [...hexToBytes(hash)]);
  const mint = Keypair.generate();
  const rebyterAuthority = rebyterAuthorityPda(mint.publicKey);
  const ownerTokenAccount = getAssociatedTokenAddressSync(
    mint.publicKey,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const mintLen = getMintLen([ExtensionType.MetadataPointer]);
  const mintRent = await connection.getMinimumBalanceForRentExemption(mintLen);

  const createMintIx = SystemProgram.createAccount({
    fromPubkey: wallet.publicKey,
    newAccountPubkey: mint.publicKey,
    space: mintLen,
    lamports: mintRent,
    programId: TOKEN_2022_PROGRAM_ID,
  });
  const metadataPointerIx = createInitializeMetadataPointerInstruction(
    mint.publicKey,
    rebyterAuthority,
    mint.publicKey,
    TOKEN_2022_PROGRAM_ID,
  );
  const initializeMintIx = createInitializeMint2Instruction(
    mint.publicKey,
    0,
    rebyterAuthority,
    null,
    TOKEN_2022_PROGRAM_ID,
  );
  const createAtaIx = createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    ownerTokenAccount,
    wallet.publicKey,
    mint.publicKey,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const program = getProgram(connection, anchorWallet);
  const playerProfile = playerProfilePda(wallet.publicKey);

  const ix = await program.methods
    .createRebyter(
      familyId,
      version,
      origin.id,
      evolutionLeafHash,
      siblings,
      origin.name,
      metadataUri,
    )
    .accountsStrict({
      owner: wallet.publicKey,
      playerProfile,
      registry: registryPda(),
      tree: treePda(familyId, version),
      rebyterAuthority,
      mint: mint.publicKey,
      ownerTokenAccount,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();

  const block = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ ...block, feePayer: wallet.publicKey }).add(
    ...budgetIxs(600_000),
    createMintIx,
    metadataPointerIx,
    initializeMintIx,
    createAtaIx,
    ix,
  );
  tx.partialSign(mint);
  const signed = await wallet.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  const result = await connection.confirmTransaction(
    { ...block, signature },
    "confirmed",
  );
  if (result.value.err)
    throw new Error(
      `create_rebyter failed: ${JSON.stringify(result.value.err)}`,
    );

  return {
    signature,
    mint: mint.publicKey.toBase58(),
    evolutionId: origin.id,
    tree,
  };
}


export type RebyterInteraction = "feed" | "play" | "care" | "rest" | "train";

export async function interactWithRebyter(
  connection: Connection,
  anchorWallet: AnchorWallet,
  wallet: RebytersTransactionWallet,
  mintString: string,
  action: RebyterInteraction,
  option = 0,
  /** Training: the specialised machine (catalog item) the wallet holds, for its bonus. */
  machine?: StoreItem,
) {
  if (!wallet.publicKey || !wallet.signTransaction)
    throw new Error("Connect a wallet that can sign transactions");

  const mint = new PublicKey(mintString);
  const ownerTokenAccount = getAssociatedTokenAddressSync(
    mint,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const rebyterAuthority = rebyterAuthorityPda(mint);
  const program = getProgram(connection, anchorWallet);

  let builder;
  if (action === "feed") builder = program.methods.feed(Math.floor(option / 4), option % 4);
  else if (action === "play") builder = program.methods.play();
  else if (action === "care") builder = program.methods.care();
  else if (action === "rest") builder = program.methods.rest();
  else builder = program.methods.train(option);
  const machineMint = machine ? DEPLOYMENT.items[machine.id]?.mint : undefined;
  const machineId = machine ? itemIdOf(machine) : null;

  // The profile counts today's actions for the quests; wallets without one (or with a legacy one)
  // get it created in the same transaction.
  const preInstructions: TransactionInstruction[] = await ensureProfileIx(connection, anchorWallet);

  const base = {
    owner: wallet.publicKey,
    mint,
    ownerTokenAccount,
    rebyterAuthority,
    playerProfile: playerProfilePda(wallet.publicKey),
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  };
  if (action === "feed") {
    // Feeding uses up one meal from the profile: say so before signing if there is none.
    const state = await fetchProfileState(connection, wallet.publicKey).catch(() => null);
    if (!state || (state.food[option] ?? 0) < 1) throw new Error("You are out of that food. Claim your daily ration or visit the store.");
  }
  const optional =
    action === "train" && machineMint && machineId !== null
      ? {
          itemType: itemTypePda(machineId),
          machineAccount: getAssociatedTokenAddressSync(new PublicKey(machineMint), wallet.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
        }
      : action === "train"
        ? { itemType: null, machineAccount: null }
        : {};
  const ix = await builder.accountsStrict({ ...base, ...optional } as never).instruction();

  const block = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ ...block, feePayer: wallet.publicKey }).add(...budgetIxs(), ...preInstructions, ix);
  const signed = await wallet.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  const result = await connection.confirmTransaction(
    { ...block, signature },
    "confirmed",
  );
  if (result.value.err)
    throw new Error(
      `${action} failed: ${JSON.stringify(result.value.err)}`,
    );

  refreshBalances();
  return signature;
}


export async function evolveRebyter(
  connection: Connection,
  anchorWallet: AnchorWallet,
  wallet: RebytersTransactionWallet,
  mintString: string,
  tree: TreeJson,
  sourceId: number,
  targetId: number,
  /** An evolution item in the wallet: it is burned and replaces the rule's requirements. */
  item?: StoreItem,
) {
  if (!wallet.publicKey || !wallet.signTransaction)
    throw new Error("Connect a wallet that can sign transactions");
  const evolutionTree = tree;
  const source = evolutionTree.evolutions.find((e) => e.id === sourceId);
  const path = source?.paths.find((p) => p.target === targetId);
  const target = evolutionTree.evolutions.find((e) => e.id === targetId);
  if (!source || !path || !target)
    throw new Error("Evolution path is not part of this atlas");
  if (!path.rule)
    throw new Error("This path has no structured gameplay rule");

  if (evolutionTree.proofMode !== "unified-v1")
    throw new Error("Current Rebyter DNA requires a unified active atlas");
  const proof = buildMerkleTree(evolutionTree).getRuleProof(sourceId, targetId);
  const mint = new PublicKey(mintString);
  const ownerTokenAccount = getAssociatedTokenAddressSync(
    mint,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const rebyterAuthority = rebyterAuthorityPda(mint);
  const program = getProgram(connection, anchorWallet);
  const itemMint = item ? DEPLOYMENT.items[item.id]?.mint : undefined;
  const itemId = item ? itemIdOf(item) : null;
  const itemAccounts =
    itemMint && itemId !== null
      ? {
          itemType: itemTypePda(itemId),
          itemMint: new PublicKey(itemMint),
          ownerItemAccount: getAssociatedTokenAddressSync(new PublicKey(itemMint), wallet.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
        }
      : { itemType: null, itemMint: null, ownerItemAccount: null };

  const ix = await program.methods
    .evolve(
      target.id,
      target.stage,
      target.name,
      target.assets?.metadataUri ?? "",
      Buffer.from(proof.ruleBytes),
      proof.siblings.map((hash) => Buffer.from(hexToBytes(hash))),
    )
    .accountsStrict({
      owner: wallet.publicKey,
      playerProfile: playerProfilePda(wallet.publicKey),
      mint,
      ownerTokenAccount,
      rebyterAuthority,
      registry: registryPda(),
      tree: treePda(evolutionTree.family.id, evolutionTree.version),
      ruleSet: treePda(evolutionTree.family.id, evolutionTree.version),
      ...itemAccounts,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as never)
    .instruction();

  const block = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ ...block, feePayer: wallet.publicKey }).add(
    ...budgetIxs(600_000),
    ...(await ensureProfileIx(connection, anchorWallet)),
    ix,
  );
  const signed = await wallet.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  const result = await connection.confirmTransaction(
    { ...block, signature },
    "confirmed",
  );
  if (result.value.err)
    throw new Error(
      `evolve failed: ${JSON.stringify(result.value.err)}`,
    );
  return signature;
}
