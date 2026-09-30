import { canonicalTree, contentHash } from "./canonical";
import { buildMerkleTree } from "./merkle";
import { validateTree } from "./validation";
import type { TreeJson, Publication } from "./types";
export interface Uploader {
  upload: (
    data: string,
    options: { tags: { name: string; value: string }[] },
  ) => Promise<{ id: string }>;
}
export async function uploadTreeToIrys(
  tree: TreeJson,
  uploader: Uploader,
  gateway = "https://gateway.irys.xyz",
): Promise<Publication> {
  validateTree(tree);
  const bytes = canonicalTree(tree);
  const receipt = await uploader.upload(bytes, {
    tags: [
      { name: "Content-Type", value: "application/json" },
      { name: "App-Name", value: "Rebyters" },
      { name: "Content-Type-Version", value: "1" },
      { name: "Family", value: String(tree.family.id) },
      { name: "Version", value: String(tree.version) },
    ],
  });
  if (!/^[A-Za-z0-9_-]+$/.test(receipt.id))
    throw new Error("Invalid Irys receipt");
  return {
    uri: `${gateway.replace(/\/$/, "")}/${receipt.id}`,
    contentHash: contentHash(tree),
    merkleRoot: buildMerkleTree(tree).root,
  };
}
