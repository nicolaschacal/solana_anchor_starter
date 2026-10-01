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

export function rebyterAuthorityPda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("rebyter_authority"), mint.toBytes()],
    PROGRAM_ID,
  )[0];
}

function parseHexBytes(value: string | undefined) {
  if (!value || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return [];
  return Array.from(hexToBytes(value));
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
    if (fields.get("schema") !== "rebyter-v1") continue;

    let state: any;
    try {
      state = JSON.parse(fields.get("state") ?? "{}");
    } catch {
      continue;
    }

    result.push({
      address: mintString,
      owner: owner.toBase58(),
      mint: mintString,
      familyId: Number(state.family ?? 0),
      stage: Number(state.stage ?? 0),
      treeVersion: Number(state.tree ?? 0),
      evolutionId: Number(state.evolution ?? 0),
      evolutionLeafHash: parseHexBytes(fields.get("atlas_leaf")),
      dna: parseHexBytes(fields.get("dna")),
      genes: parseHexBytes(fields.get("genes")),
      weight: Number(state.weight ?? 10),
      bond: Number(state.bond ?? 0),
      activity: Number(state.activity ?? 0),
      hunger: Number(state.hunger ?? 100),
      energy: Number(state.energy ?? 100),
      diet: Array.isArray(state.diet) ? state.diet.map(Number) : [0, 0, 0, 0],
      timeInteractions: Array.isArray(state.time)
        ? state.time.map(Number)
        : [0, 0, 0, 0],
      totalInteractions: Number(state.interactions ?? 0),
      cycle: Number(state.cycle ?? 0),
      lastInteraction: Number(state.last ?? 0),
      createdAt: Number(state.created ?? 0),
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
