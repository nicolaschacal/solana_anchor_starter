import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, concatBytes } from "@noble/hashes/utils";
import { leafBytes, normalizeTree } from "./canonical";
import { validateTree } from "./validation";
import type { Evolution, TreeJson } from "./types";
import { encodeRule, ruleLeafHash } from "./rule-merkle";
export interface EvolutionProof {
  evolutionId: number;
  siblings: string[];
}
export const leafHash = (tree: TreeJson, e: Evolution) =>
  bytesToHex(sha256(concatBytes(Uint8Array.of(0), leafBytes(tree, e))));
function parent(a: string, b: string) {
  const [left, right] = [a, b].sort();
  return bytesToHex(
    sha256(concatBytes(Uint8Array.of(1), hexToBytes(left), hexToBytes(right))),
  );
}
export function buildMerkleTree(input: TreeJson) {
  // Irys stores canonicalTree(), which normalizes rule/path ordering.
  // Build proofs from that exact normalized representation as well so the
  // pre-upload root and the root recomputed from immutable JSON are identical.
  const tree = normalizeTree(validateTree(input));
  const evolutionEntries = [...tree.evolutions]
    .sort((a, b) => a.id - b.id)
    .map((e) => ({
      kind: "evolution" as const,
      evolutionId: e.id,
      hash: leafHash(tree, e),
    }));
  const ruleEntries =
    tree.proofMode === "unified-v1"
      ? tree.evolutions
          .flatMap((source) =>
            source.paths
              .filter((path) => !!path.rule)
              .map((path) => ({
                kind: "rule" as const,
                sourceId: source.id,
                targetId: path.target,
                hash: ruleLeafHash(tree, source.id, path),
              })),
          )
          .sort((a, b) => a.sourceId - b.sourceId || a.targetId - b.targetId)
      : [];
  const entries = [...evolutionEntries, ...ruleEntries];
  if (!entries.length) throw new Error("Atlas has no Merkle entries");
  const levels: string[][] = [entries.map((entry) => entry.hash)];
  while (levels.at(-1)!.length > 1) {
    const current = levels.at(-1)!,
      next: string[] = [];
    for (let i = 0; i < current.length; i += 2)
      next.push(parent(current[i], current[i + 1] ?? current[i]));
    levels.push(next);
  }
  const siblingsFor = (startIndex: number) => {
    let index = startIndex;
    const siblings: string[] = [];
    for (const level of levels.slice(0, -1)) {
      siblings.push(level[index ^ 1] ?? level[index]);
      index = Math.floor(index / 2);
    }
    return siblings;
  };
  return {
    root: levels.at(-1)![0],
    getEvolutionProof(evolutionId: number): EvolutionProof {
      const index = entries.findIndex(
        (entry) =>
          entry.kind === "evolution" && entry.evolutionId === evolutionId,
      );
      if (index < 0) throw new Error("Unknown evolution ID");
      return { evolutionId, siblings: siblingsFor(index) };
    },
    getRuleProof(sourceId: number, targetId: number) {
      if (tree.proofMode !== "unified-v1")
        throw new Error("This atlas version uses a legacy separate rule root");
      const index = entries.findIndex(
        (entry) =>
          entry.kind === "rule" &&
          entry.sourceId === sourceId &&
          entry.targetId === targetId,
      );
      if (index < 0) throw new Error("Unknown evolution path");
      const source = tree.evolutions.find((e) => e.id === sourceId);
      const path = source?.paths.find((p) => p.target === targetId);
      const target = tree.evolutions.find((e) => e.id === targetId);
      if (!source || !path || !target || !path.rule)
        throw new Error("Structured evolution path is missing");
      return {
        siblings: siblingsFor(index),
        ruleBytes: encodeRule(tree, path, target.stage),
        target,
      };
    },
  };
}
export function getEvolutionProof(tree: TreeJson, id: number) {
  return buildMerkleTree(tree).getEvolutionProof(id);
}
export function verifyEvolutionProof(
  tree: TreeJson,
  evolution: Evolution,
  proof: EvolutionProof,
  root: string,
): boolean {
  if (
    proof.evolutionId !== evolution.id ||
    proof.siblings.length > 16 ||
    !/^[0-9a-f]{64}$/.test(root) ||
    proof.siblings.some((s) => !/^[0-9a-f]{64}$/.test(s))
  )
    return false;
  return proof.siblings.reduce(parent, leafHash(tree, evolution)) === root;
}
