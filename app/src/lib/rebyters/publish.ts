import type { RegistryWriter } from "./registry";
import { fetchRegistry, fetchRuleSet, fetchTree } from "./registry";
import { fetchVerifiedTree } from "./tree";
import { validateTree, assertCompatible } from "./validation";
import { contentHash } from "./canonical";
import { uploadTreeToIrys, type Uploader } from "./irys";
import type { TreeJson, Publication } from "./types";
import type { Progress } from "./transactions";
export interface PublishJournal {
  tree: TreeJson;
  baseVersion: number;
  publication?: Publication;
  activationSubmitted?: boolean;
  replaceCollection?: boolean;
}
export async function publishTree(
  writer: RegistryWriter,
  journal: PublishJournal,
  uploader: () => Promise<Uploader>,
  save: (j: PublishJournal) => void | Promise<void>,
  progress: Progress,
  gateway: string,
) {
  const tree = validateTree(journal.tree),
    family = tree.family.id;
  progress("Preparing...");
  let root = await fetchRegistry(writer.connection);
  if (!root || root.authority !== writer.wallet.publicKey.toBase58())
    throw new Error("Wallet is not registry authority");
  let existing = await fetchTree(writer.connection, family, tree.version);
  if (
    root.activeVersions[family] === tree.version &&
    existing &&
    existing.contentHash === contentHash(tree)
  ) {
    const verified = await fetchVerifiedTree(existing);
    progress("Published successfully");
    return verified;
  }
  if (root.activeVersions[family] !== journal.baseVersion)
    throw new Error(
      "Active version changed. Reload before publishing. Your draft is preserved.",
    );
  if (journal.baseVersion) {
    const previous = await fetchTree(
      writer.connection,
      family,
      journal.baseVersion,
    );
    if (!previous) throw new Error("Active tree missing");
    const previousTree = await fetchVerifiedTree(previous);
    if (journal.replaceCollection) {
      const previousIds = new Set(previousTree.evolutions.map((e) => e.id));
      if (tree.evolutions.some((e) => previousIds.has(e.id)))
        throw new Error("A replacement collection must use fresh reserved IDs");
    } else {
      assertCompatible(previousTree, tree);
    }
  }
  if (tree.evolutions.some((e) => e.id >= root!.nextEvolutionId))
    throw new Error("Evolution IDs must be reserved through the registry");
  if (!existing && root.nextVersions[family] !== tree.version)
    throw new Error(
      "Version was used by another publication. Refresh the draft version.",
    );
  if (journal.publication?.contentHash !== contentHash(tree)) {
    journal.publication = undefined;
    journal.activationSubmitted = false;
    await save(journal);
  }
  if (!journal.publication) {
    progress("Uploading immutable JSON to Irys...");
    journal.publication = await uploadTreeToIrys(
      tree,
      await uploader(),
      gateway,
    );
    await save(journal);
  }
  progress("Verifying uploaded content...");
  await fetchVerifiedTree({
    ...journal.publication,
    familyId: family,
    version: tree.version,
    address: "",
    createdAt: 0,
  });
  if (
    existing &&
    (existing.contentHash !== journal.publication.contentHash ||
      existing.merkleRoot !== journal.publication.merkleRoot ||
      existing.uri !== journal.publication.uri)
  )
    throw new Error("Version already exists with different content");
  if (!existing) {
    progress("Creating tree PDA...");
    await writer.create(family, tree.version, journal.publication);
    existing = await fetchTree(writer.connection, family, tree.version);
  }
  if (tree.schema === 2) {
    const rules = await fetchRuleSet(writer.connection, family, tree.version);
    if (!rules) {
      progress("Publishing gameplay rule root...");
      await writer.createRuleSet(tree);
    }
  }
  root = await fetchRegistry(writer.connection);
  if (root?.activeVersions[family] !== tree.version) {
    if (root?.activeVersions[family] !== journal.baseVersion)
      throw new Error("Active version changed before activation");
    progress("Activating...");
    journal.activationSubmitted = true;
    await save(journal);
    await writer.activate(family, tree.version);
  }
  progress("Confirming active version...");
  root = await fetchRegistry(writer.connection);
  if (root?.activeVersions[family] !== tree.version || !existing)
    throw new Error(
      "Activation not confirmed; retry will refetch the registry",
    );
  const verified = await fetchVerifiedTree(existing);
  progress("Published successfully");
  return verified;
}
