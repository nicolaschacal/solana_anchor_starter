import bs58 from "bs58";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { Connection, PublicKey } from "@solana/web3.js";
import { hexToBytes } from "@noble/hashes/utils";
import {
  create,
  fetchAssetsByOwner,
  mplCore,
} from "@metaplex-foundation/mpl-core";
import {
  generateSigner,
  publicKey as umiPublicKey,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { walletAdapterIdentity } from "@metaplex-foundation/umi-signer-wallet-adapters";
import { PROGRAM_ID } from "./config";
import { fetchRegistry, fetchTree } from "./registry";
import { fetchVerifiedTree } from "./tree";
import { leafHash } from "./merkle";
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
  wallet: WalletContextState,
  familyId: number,
) {
  if (familyId !== 0) throw new Error("Only Mammal creation is enabled");
  if (!wallet.publicKey)
    throw new Error("Connect a wallet");

  const { tree, version } = await fetchActiveFamilyTree(connection, familyId);
  const origin = tree.evolutions.find((e) => e.stage === 0 && e.enabled);
  if (!origin) throw new Error("Active family has no enabled BIT origin");

  const metadataUri = origin.assets?.metadataUri;
  if (!metadataUri?.startsWith("https://"))
    throw new Error(
      "The Mammal BIT reference has not been published to Irys yet.",
    );

  const evolutionLeafHash = Array.from(hexToBytes(leafHash(tree, origin)));
  const genomeSeed = new Uint8Array(32);
  crypto.getRandomValues(genomeSeed);
  const genes = Array.from(genomeSeed.slice(0, 14), (value) => value % 101);
  const createdAt = Math.floor(Date.now() / 1000);
  const dnaBase58 = encodeDnaV1({
    familyId,
    stage: 0,
    treeVersion: version,
    evolutionId: origin.id,
    evolutionLeafHash,
    genomeSeed: Array.from(genomeSeed),
    genes,
    createdAt,
  });

  const umi = createUmi(connection.rpcEndpoint)
    .use(mplCore())
    .use(walletAdapterIdentity(wallet as any));

  const asset = generateSigner(umi);
  const assetWeb3 = new PublicKey(asset.publicKey.toString());
  const updateAuthority = rebyterAuthorityPda(assetWeb3);

  const sent = await create(umi, {
    asset,
    owner: umiPublicKey(wallet.publicKey.toBase58()),
    updateAuthority: umiPublicKey(updateAuthority.toBase58()),
    name: origin.name,
    uri: metadataUri,
    plugins: [
      {
        type: "Attributes",
        attributeList: [{ key: "DNA", value: dnaBase58 }],
      },
    ],
  }).sendAndConfirm(umi);

  return {
    signature: bs58.encode(sent.signature),
    asset: asset.publicKey.toString(),
    mint: asset.publicKey.toString(),
    evolutionId: origin.id,
    dnaBase58,
    tree,
  };
}
