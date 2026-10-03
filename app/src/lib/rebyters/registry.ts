import {
  AnchorProvider,
  Program,
  type Idl,
  type Wallet,
} from "@anchor-lang/core";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import {
  Connection,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import idl from "../../idl/solana_anchor_starter.json";
import { PROGRAM_ID, registryPda, ruleSetPda, treePda } from "./config";
import type { Registry, TreeMetadata, Publication, TreeJson } from "./types";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { buildRuleMerkleTree } from "./rule-merkle";
export type RebytersProviderWallet = Wallet | AnchorWallet;

export function getProgram(
  connection: Connection,
  wallet?: RebytersProviderWallet,
) {
  return new Program(
    idl as Idl,
    wallet
      ? new AnchorProvider(
          connection,
          wallet as ConstructorParameters<typeof AnchorProvider>[1],
          { commitment: "confirmed" },
        )
      : { connection },
  );
}
export async function fetchRegistry(
  connection: Connection,
): Promise<Registry | null> {
  const p = getProgram(connection);
  const root = await (p.account as any).registryRoot.fetchNullable(
    registryPda(),
  );
  return root
    ? {
        authority: root.authority.toBase58(),
        nextEvolutionId: root.nextEvolutionId,
        activeVersions: root.activeVersions,
        nextVersions: root.nextVersions,
      }
    : null;
}
function metadata(publicKey: PublicKey, a: any): TreeMetadata {
  return {
    address: publicKey.toBase58(),
    familyId: a.familyId,
    version: a.version,
    uri: new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(a.uri.slice(0, a.uriLen)),
    ),
    merkleRoot: bytesToHex(Uint8Array.from(a.merkleRoot)),
    contentHash: bytesToHex(Uint8Array.from(a.contentHash)),
    createdAt: a.createdAt.toNumber(),
  };
}
export async function fetchTree(
  connection: Connection,
  family: number,
  version: number,
): Promise<TreeMetadata | null> {
  const address = treePda(family, version),
    a = await (
      getProgram(connection).account as any
    ).evolutionTree.fetchNullable(address);
  if (!a) return null;
  if (a.familyId !== family || a.version !== version)
    throw new Error("Tree identity mismatch");
  return metadata(address, a);
}
export async function fetchRuleSet(
  connection: Connection,
  family: number,
  version: number,
) {
  const address = ruleSetPda(family, version);
  const a = await (getProgram(connection).account as any).ruleSet.fetchNullable(address);
  return a
    ? {
        address: address.toBase58(),
        familyId: a.familyId as number,
        treeVersion: a.treeVersion as number,
        rulesRoot: bytesToHex(Uint8Array.from(a.rulesRoot)),
      }
    : null;
}
export async function fetchVersions(
  connection: Connection,
  family: number,
): Promise<TreeMetadata[]> {
  const records = await (
    getProgram(connection).account as any
  ).evolutionTree.all();
  return records
    .filter((r: any) => r.account.familyId === family)
    .map((r: any) => metadata(r.publicKey, r.account))
    .filter(
      (r: TreeMetadata) =>
        treePda(r.familyId, r.version).toBase58() === r.address,
    )
    .sort((a: TreeMetadata, b: TreeMetadata) => b.version - a.version);
}
export class RegistryWriter {
  constructor(
    public connection: Connection,
    public wallet: Wallet,
    public send: (ix: TransactionInstruction) => Promise<string>,
  ) {}
  get program() {
    return getProgram(this.connection, this.wallet);
  }
  get common() {
    return { authority: this.wallet.publicKey, registry: registryPda() };
  }
  async initialize() {
    const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
    return this.send(
      await this.program.methods
        .initializeRegistry()
        .accountsStrict({
          ...this.common,
          programData: PublicKey.findProgramAddressSync(
            [PROGRAM_ID.toBytes()],
            loader,
          )[0],
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );
  }
  async reserve(count: number) {
    const root = await fetchRegistry(this.connection);
    if (!root) throw new Error("Initialize registry first");
    if (root.nextEvolutionId + count > 65536)
      throw new Error("Evolution IDs exhausted");
    await this.send(
      await this.program.methods
        .reserveEvolutionIds(root.nextEvolutionId, count)
        .accountsStrict(this.common)
        .instruction(),
    );
    return root.nextEvolutionId;
  }
  async create(family: number, version: number, p: Publication) {
    return this.send(
      await this.program.methods
        .createTree(
          family,
          version,
          [...hexToBytes(p.merkleRoot)],
          [...hexToBytes(p.contentHash)],
          p.uri,
        )
        .accountsStrict({
          ...this.common,
          tree: treePda(family, version),
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );
  }
  async createRuleSet(tree: TreeJson) {
    const root = buildRuleMerkleTree(tree).root;
    return this.send(
      await this.program.methods
        .createRuleSet(tree.family.id, tree.version, [...hexToBytes(root)])
        .accountsStrict({
          ...this.common,
          tree: treePda(tree.family.id, tree.version),
          ruleSet: ruleSetPda(tree.family.id, tree.version),
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );
  }
  async activate(family: number, version: number) {
    return this.send(
      await this.program.methods
        .activateTree(family, version)
        .accountsStrict({ ...this.common, tree: treePda(family, version) })
        .instruction(),
    );
  }
  async close(family: number, version: number) {
    return this.send(
      await this.program.methods
        .closeTree(family, version)
        .accountsStrict({ ...this.common, tree: treePda(family, version) })
        .instruction(),
    );
  }
  async setAuthority(address: string) {
    return this.send(
      await this.program.methods
        .setAuthority(new PublicKey(address))
        .accountsStrict(this.common)
        .instruction(),
    );
  }
}
