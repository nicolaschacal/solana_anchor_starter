import { it, expect, vi, afterEach } from "vitest";
import { fetchVerifiedTree } from "./tree";
import { sampleMammal } from "./sample";
import { contentHash } from "./canonical";
import { buildMerkleTree } from "./merkle";
const tree = sampleMammal(),
  metadata = {
    familyId: 0,
    version: 1,
    address: "test",
    createdAt: 0,
    uri: "https://gateway.irys.xyz/test",
    contentHash: contentHash(tree),
    merkleRoot: buildMerkleTree(tree).root,
  };
afterEach(() => vi.unstubAllGlobals());
it("verifies both on-chain commitments before returning content", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(tree))),
  );
  expect(await fetchVerifiedTree(metadata)).toEqual(tree);
  await expect(
    fetchVerifiedTree({ ...metadata, contentHash: "0".repeat(64) }),
  ).rejects.toThrow("CONTENT VERIFICATION FAILED");
  await expect(
    fetchVerifiedTree({ ...metadata, merkleRoot: "0".repeat(64) }),
  ).rejects.toThrow("CONTENT VERIFICATION FAILED");
  await expect(fetchVerifiedTree({ ...metadata, version: 2 })).rejects.toThrow(
    "CONTENT VERIFICATION FAILED",
  );
});
