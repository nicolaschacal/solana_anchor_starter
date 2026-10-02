import bs58 from "bs58";
import type { Wallet } from "@anchor-lang/core";
import type { WalletContextState } from "@solana/wallet-adapter-react";
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
} from "@solana/web3.js";
import { hexToBytes } from "@noble/hashes/utils";
import { PROGRAM_ID, registryPda, ruleSetPda, treePda } from "./config";
import { getProgram, fetchRegistry, fetchTree } from "./registry";
import { fetchVerifiedTree } from "./tree";
import { buildMerkleTree, leafHash } from "./merkle";
import { buildRuleMerkleTree } from "./rule-merkle";
import type { TreeJson } from "./types";

export interface OnchainRebyter {
  address: string;
  owner: string;
  mint: string;
  familyId: number;
  stage: number;
  treeVersion: number;
  evolutionId: number;
  evolutionLeafHash: number[];
  dna: number[];
  dnaBase58: string;
  genes: number[];
  weight: number;
  bond: number;
  activity: number;
  hunger: number;
  energy: number;
  diet: number[];
  timeInteractions: number[];
  totalInteractions: number;
  cycle: number;
  lastInteraction: number;
  createdAt: number;
  hp: number;
  atk: number;
  def: number;
  spd: number;
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
function readI64(bytes: Uint8Array, offset: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
  return Number(view.getBigInt64(0, true));
}

function decodeDnaV1(value: string) {
  const bytes = Uint8Array.from(bs58.decode(value));
  let o = 0;
  const version = bytes[o++];
  if (version !== 1) throw new Error(`Unsupported Rebyter DNA version ${version}`);
  const familyId = bytes[o++];
  const stage = bytes[o++];
  const treeVersion = readU32(bytes, o); o += 4;
  const evolutionId = readU32(bytes, o); o += 4;
  const evolutionLeafHash = Array.from(bytes.slice(o, o + 32)); o += 32;
  const genomeSeed = Array.from(bytes.slice(o, o + 32)); o += 32;
  const genes = Array.from(bytes.slice(o, o + 14)); o += 14;
  const weight = readU16(bytes, o); o += 2;
  const bond = readU16(bytes, o); o += 2;
  const activity = readU32(bytes, o); o += 4;
  const hunger = readU16(bytes, o); o += 2;
  const energy = readU16(bytes, o); o += 2;
  const diet = [0, 0, 0, 0].map(() => {
    const v = readU16(bytes, o); o += 2; return v;
  });
  const timeInteractions = [0, 0, 0, 0].map(() => {
    const v = readU16(bytes, o); o += 2; return v;
  });
  const totalInteractions = readU32(bytes, o); o += 4;
  const cycle = readU16(bytes, o); o += 2;
  const lastInteraction = readI64(bytes, o); o += 8;
  const createdAt = readI64(bytes, o);
  return {
    familyId,
    stage,
    treeVersion,
    evolutionId,
    evolutionLeafHash,
    genomeSeed,
    genes,
    weight,
    bond,
    activity,
    hunger,
    energy,
    diet,
    timeInteractions,
    totalInteractions,
    cycle,
    lastInteraction,
    createdAt,
  };
}


function decodeDnaV2(value: string) {
  const bytes = Uint8Array.from(bs58.decode(value));
  if (bytes.length !== 62 || bytes[0] !== 2)
    throw new Error("Invalid Rebyter DNA v2");
  let o = 1;
  const familyId = bytes[o++];
  const stage = bytes[o++];
  const treeVersion = readU16(bytes, o); o += 2;
  const evolutionId = readU16(bytes, o); o += 2;
  const genes = Array.from(bytes.slice(o, o + 14)); o += 14;
  const weight = bytes[o++];
  const bond = bytes[o++];
  const activity = readU16(bytes, o); o += 2;
  const hunger = bytes[o++];
  const energy = bytes[o++];
  const diet = [0, 0, 0, 0].map(() => {
    const v = readU16(bytes, o); o += 2; return v;
  });
  const timeInteractions = [0, 0, 0, 0].map(() => {
    const v = readU16(bytes, o); o += 2; return v;
  });
  const totalInteractions = readU16(bytes, o); o += 2;
  const cycle = bytes[o++];
  const hp = readU16(bytes, o); o += 2;
  const atk = readU16(bytes, o); o += 2;
  const def = readU16(bytes, o); o += 2;
  const spd = readU16(bytes, o); o += 2;
  const lastInteraction = readU32(bytes, o); o += 4;
  const createdAt = readU32(bytes, o);
  return {
    familyId, stage, treeVersion, evolutionId, genes, weight, bond, activity,
    hunger, energy, diet, timeInteractions, totalInteractions, cycle,
    hp, atk, def, spd, lastInteraction, createdAt,
    evolutionLeafHash: [] as number[],
    genomeSeed: [] as number[],
  };
}

function decodeDna(value: string) {
  const bytes = Uint8Array.from(bs58.decode(value));
  if (bytes[0] === 2) return decodeDnaV2(value);
  const legacy = decodeDnaV1(value);
  return {
    ...legacy,
    hp: 100 + (legacy.genes[11] ?? 0) * 2,
    atk: 20 + (legacy.genes[9] ?? 0),
    def: 20 + (legacy.genes[11] ?? 0),
    spd: 20 + (legacy.genes[10] ?? 0),
  };
}

export async function fetchOwnedRebyters(
  connection: Connection,
  owner: PublicKey,
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

  const result: OnchainRebyter[] = [];
  for (const mintString of mints) {
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
      dnaState = decodeDna(dnaField);
    } catch {
      continue;
    }

    result.push({
      address: mintString,
      owner: owner.toBase58(),
      mint: mintString,
      familyId: dnaState.familyId,
      stage: dnaState.stage,
      treeVersion: dnaState.treeVersion,
      evolutionId: dnaState.evolutionId,
      evolutionLeafHash: dnaState.evolutionLeafHash,
      dna: dnaState.genomeSeed,
      dnaBase58: dnaField,
      genes: dnaState.genes,
      weight: dnaState.weight,
      bond: dnaState.bond,
      activity: dnaState.activity,
      hunger: dnaState.hunger,
      energy: dnaState.energy,
      diet: dnaState.diet,
      timeInteractions: dnaState.timeInteractions,
      totalInteractions: dnaState.totalInteractions,
      cycle: dnaState.cycle,
      lastInteraction: dnaState.lastInteraction,
      createdAt: dnaState.createdAt,
      hp: dnaState.hp,
      atk: dnaState.atk,
      def: dnaState.def,
      spd: dnaState.spd,
      metadataUri: metadata.uri,
    });
  }
  return result;
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

export async function createRebyter(
  connection: Connection,
  anchorWallet: Wallet,
  wallet: WalletContextState,
  familyId: number,
) {
  if (familyId !== 0) throw new Error("Only Mammal creation is enabled");
  if (!wallet.publicKey || !wallet.signTransaction)
    throw new Error("Connect a wallet that can sign transactions");

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
      registry: registryPda(),
      tree: treePda(familyId, version),
      rebyterAuthority,
      mint: mint.publicKey,
      ownerTokenAccount,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const block = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ ...block, feePayer: wallet.publicKey }).add(
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


export type RebyterInteraction = "feed" | "play" | "care";

export async function interactWithRebyter(
  connection: Connection,
  anchorWallet: Wallet,
  wallet: WalletContextState,
  mintString: string,
  action: RebyterInteraction,
  foodType = 0,
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
  if (action === "feed") builder = program.methods.feed(foodType);
  else if (action === "play") builder = program.methods.play();
  else builder = program.methods.care();

  const ix = await builder
    .accountsStrict({
      owner: wallet.publicKey,
      mint,
      ownerTokenAccount,
      rebyterAuthority,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .instruction();

  const block = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ ...block, feePayer: wallet.publicKey }).add(ix);
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

  return signature;
}


export async function evolveRebyter(
  connection: Connection,
  anchorWallet: Wallet,
  wallet: WalletContextState,
  mintString: string,
  tree: TreeJson,
  sourceId: number,
  targetId: number,
) {
  if (!wallet.publicKey || !wallet.signTransaction)
    throw new Error("Connect a wallet that can sign transactions");
  const source = tree.evolutions.find((e) => e.id === sourceId);
  const path = source?.paths.find((p) => p.target === targetId);
  const target = tree.evolutions.find((e) => e.id === targetId);
  if (!source || !path || !target)
    throw new Error("Evolution path is not part of this atlas");
  if (!path.rule)
    throw new Error("This path has no structured gameplay rule");

  const proof = buildRuleMerkleTree(tree).getProof(sourceId, targetId);
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

  const ix = await program.methods
    .evolve(
      target.id,
      target.stage,
      target.name,
      target.assets?.metadataUri ?? "",
      [...proof.ruleBytes],
      proof.siblings.map((hash) => [...hexToBytes(hash)]),
    )
    .accountsStrict({
      owner: wallet.publicKey,
      mint,
      ownerTokenAccount,
      rebyterAuthority,
      ruleSet: ruleSetPda(tree.family.id, tree.version),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .instruction();

  const block = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ ...block, feePayer: wallet.publicKey }).add(ix);
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
