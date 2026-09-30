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
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { hexToBytes } from "@noble/hashes/utils";
import { PROGRAM_ID, registryPda, treePda } from "./config";
import { getProgram, fetchRegistry, fetchTree } from "./registry";
import { fetchVerifiedTree } from "./tree";
import { buildMerkleTree, leafHash } from "./merkle";
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

export function rebyterPda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("rebyter"), mint.toBytes()],
    PROGRAM_ID,
  )[0];
}

function decodeFixedUtf8(value: number[], len: number) {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(value.slice(0, len)),
  );
}

export async function fetchOwnedRebyters(
  connection: Connection,
  owner: PublicKey,
): Promise<OnchainRebyter[]> {
  const program = getProgram(connection);
  const records = await (program.account as any).rebyter.all([
    { memcmp: { offset: 8, bytes: owner.toBase58() } },
  ]);
  return records.map((record: any) => {
    const a = record.account;
    return {
      address: record.publicKey.toBase58(),
      owner: a.owner.toBase58(),
      mint: a.mint.toBase58(),
      familyId: a.familyId,
      stage: a.stage,
      treeVersion: a.treeVersion,
      evolutionId: a.evolutionId,
      evolutionLeafHash: Array.from(a.evolutionLeafHash),
      dna: Array.from(a.dna),
      genes: Array.from(a.genes),
      weight: a.weight,
      bond: a.bond,
      activity: a.activity,
      hunger: a.hunger,
      energy: a.energy,
      diet: a.diet,
      timeInteractions: a.timeInteractions,
      totalInteractions: a.totalInteractions,
      cycle: a.cycle,
      lastInteraction: a.lastInteraction.toNumber(),
      createdAt: a.createdAt.toNumber(),
      metadataUri: decodeFixedUtf8(a.metadataUri, a.metadataUriLen),
    } satisfies OnchainRebyter;
  });
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
  const rebyter = rebyterPda(mint.publicKey);
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
    rebyter,
    mint.publicKey,
    TOKEN_2022_PROGRAM_ID,
  );
  const initializeMintIx = createInitializeMint2Instruction(
    mint.publicKey,
    0,
    rebyter,
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
      rebyter,
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
    rebyter: rebyter.toBase58(),
    evolutionId: origin.id,
    tree,
  };
}
