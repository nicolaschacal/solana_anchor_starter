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
