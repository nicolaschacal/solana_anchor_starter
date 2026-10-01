import bs58 from "bs58";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import type { Wallet } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { hexToBytes } from "@noble/hashes/utils";
import {
  fetchAssetsByOwner,
  mplCore,
} from "@metaplex-foundation/mpl-core";
import {
  publicKey as umiPublicKey,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { MPL_CORE_PROGRAM_ID, PROGRAM_ID, registryPda, treePda } from "./config";
import { fetchRegistry, fetchTree, getProgram } from "./registry";
import { fetchVerifiedTree } from "./tree";
import { buildMerkleTree, leafHash } from "./merkle";
import type { TreeJson } from "./types";

export interface OnchainRebyter {
  address: string;
  owner: string;
  // Kept as an alias while the UI migrates its terminology from mint -> asset.
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
  metadataUri: string;
}

export function rebyterAuthorityPda(asset: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("rebyter_authority"), asset.toBytes()],
    PROGRAM_ID,
  )[0];
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

function writeU16(out: number[], value: number) {
  out.push(value & 0xff, (value >>> 8) & 0xff);
}
function writeU32(out: number[], value: number) {
  out.push(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}
function writeI64(out: number[], value: number) {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigInt64(0, BigInt(value), true);
  out.push(...new Uint8Array(buffer));
}

function encodeDnaV1(args: {
  familyId: number;
  stage: number;
  treeVersion: number;
  evolutionId: number;
  evolutionLeafHash: number[];
  genomeSeed: number[];
  genes: number[];
  createdAt: number;
}) {
  const out: number[] = [1, args.familyId, args.stage];
  writeU32(out, args.treeVersion);
  writeU32(out, args.evolutionId);
  out.push(...args.evolutionLeafHash);
  out.push(...args.genomeSeed);
  out.push(...args.genes);
  writeU16(out, 10); // weight
  writeU16(out, 0); // bond
  writeU32(out, 0); // activity
  writeU16(out, 100); // hunger
  writeU16(out, 100); // energy
  for (let i = 0; i < 4; i++) writeU16(out, 0); // diet
  for (let i = 0; i < 4; i++) writeU16(out, 0); // time interactions
  writeU32(out, 0); // total interactions
  writeU16(out, 0); // cycle
  writeI64(out, args.createdAt); // last interaction
  writeI64(out, args.createdAt);
  return bs58.encode(Uint8Array.from(out));
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

function dnaFromCoreAsset(asset: any): string | null {
  const candidates = [
    asset?.attributes?.attributeList,
    asset?.plugins?.attributes?.attributeList,
    asset?.plugins?.Attributes?.attributeList,
    asset?.plugins?.find?.((plugin: any) => plugin?.type === "Attributes")?.attributeList,
  ];
  for (const list of candidates) {
    if (!Array.isArray(list)) continue;
    const dna = list.find((item: any) => item?.key === "DNA")?.value;
    if (typeof dna === "string" && dna.length) return dna;
  }
  return null;
}

export async function fetchOwnedRebyters(
  connection: Connection,
  owner: PublicKey,
): Promise<OnchainRebyter[]> {
  const umi = createUmi(connection.rpcEndpoint).use(mplCore());
  const assets = await fetchAssetsByOwner(
    umi,
    umiPublicKey(owner.toBase58()),
    { skipDerivePlugins: false },
  );

  const result: OnchainRebyter[] = [];
  for (const asset of assets as any[]) {
    const dnaBase58 = dnaFromCoreAsset(asset);
    if (!dnaBase58) continue;

    let dnaState;
    try {
      dnaState = decodeDnaV1(dnaBase58);
    } catch {
      continue;
    }

    const address = String(asset.publicKey);
    result.push({
      address,
      owner: String(asset.owner),
      mint: address,
      familyId: dnaState.familyId,
      stage: dnaState.stage,
      treeVersion: dnaState.treeVersion,
      evolutionId: dnaState.evolutionId,
      evolutionLeafHash: dnaState.evolutionLeafHash,
      dna: dnaState.genomeSeed,
      dnaBase58,
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
      metadataUri: String(asset.uri ?? ""),
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
      "The Mammal BIT reference has not been published to Irys yet.",
    );

  const proof = buildMerkleTree(tree).getEvolutionProof(origin.id);
  const evolutionLeafHash = Array.from(hexToBytes(leafHash(tree, origin)));
  const siblings = proof.siblings.map((hash) => Array.from(hexToBytes(hash)));

  const asset = Keypair.generate();
  const rebyterAuthority = rebyterAuthorityPda(asset.publicKey);
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
      asset: asset.publicKey,
      coreProgram: MPL_CORE_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const block = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ ...block, feePayer: wallet.publicKey }).add(ix);
  tx.partialSign(asset);

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
    asset: asset.publicKey.toBase58(),
    mint: asset.publicKey.toBase58(),
    evolutionId: origin.id,
    tree,
  };
}
