import { validateTree } from "./validation";
import { contentHash } from "./canonical";
import { buildMerkleTree } from "./merkle";
import type { TreeJson, TreeMetadata } from "./types";
export async function fetchVerifiedTree(
  metadata: TreeMetadata,
): Promise<TreeJson> {
  const url = new URL(metadata.uri);
  if (url.protocol !== "https:")
    throw new Error("CONTENT VERIFICATION FAILED: insecure URI");
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok)
    throw new Error(`Content download failed (${response.status})`);
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error("Content exceeds 2 MB limit");
  const tree = validateTree(JSON.parse(text));
  if (
    tree.family.id !== metadata.familyId ||
    tree.version !== metadata.version ||
    contentHash(tree) !== metadata.contentHash ||
    buildMerkleTree(tree).root !== metadata.merkleRoot
  )
    throw new Error("CONTENT VERIFICATION FAILED: JSON does not match Solana");
  return tree;
}


/**
 * Migration-only reader for a previously published atlas whose historical
 * structured-rule vocabulary is no longer accepted by the current validator.
 *
 * We still authenticate the immutable JSON against Solana's contentHash and
 * identity. We intentionally do not reinterpret or validate its old gameplay
 * rules, because the DNA v3 migration replaces those rules completely.
 */
export async function fetchVerifiedTreeForMigration(
  metadata: TreeMetadata,
): Promise<TreeJson> {
  const url = new URL(metadata.uri);
  if (url.protocol !== "https:")
    throw new Error("CONTENT VERIFICATION FAILED: insecure URI");
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok)
    throw new Error(`Content download failed (${response.status})`);
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error("Content exceeds 2 MB limit");

  const parsed = JSON.parse(text) as Partial<TreeJson>;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !parsed.family ||
    typeof parsed.family.id !== "number" ||
    typeof parsed.version !== "number" ||
    !Array.isArray(parsed.evolutions)
  ) {
    throw new Error("CONTENT VERIFICATION FAILED: invalid legacy atlas shape");
  }

  const tree = parsed as TreeJson;
  if (
    tree.family.id !== metadata.familyId ||
    tree.version !== metadata.version ||
    contentHash(tree) !== metadata.contentHash
  ) {
    throw new Error("CONTENT VERIFICATION FAILED: legacy JSON does not match Solana");
  }

  const ids = new Set<number>();
  for (const evolution of tree.evolutions) {
    if (
      !evolution ||
      !Number.isInteger(evolution.id) ||
      typeof evolution.name !== "string" ||
      !Array.isArray(evolution.paths)
    ) {
      throw new Error("CONTENT VERIFICATION FAILED: invalid legacy evolution shape");
    }
    if (ids.has(evolution.id))
      throw new Error("CONTENT VERIFICATION FAILED: duplicate legacy evolution ID");
    ids.add(evolution.id);
  }
  for (const evolution of tree.evolutions) {
    for (const path of evolution.paths) {
      if (!Number.isInteger(path.target) || !ids.has(path.target))
        throw new Error("CONTENT VERIFICATION FAILED: invalid legacy evolution target");
    }
  }

  return tree;
}
