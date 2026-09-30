import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, concatBytes } from "@noble/hashes/utils";
import { leafBytes } from "./canonical";
import { validateTree } from "./validation";
import type { Evolution, TreeJson } from "./types";
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
  const tree = validateTree(input);
  const entries = [...tree.evolutions].sort((a, b) => a.id - b.id);
  const levels: string[][] = [entries.map((e) => leafHash(tree, e))];
  while (levels.at(-1)!.length > 1) {
    const current = levels.at(-1)!,
      next: string[] = [];
    for (let i = 0; i < current.length; i += 2)
      next.push(parent(current[i], current[i + 1] ?? current[i]));
    levels.push(next);
  }
  return {
    root: levels.at(-1)![0],
    getEvolutionProof(evolutionId: number): EvolutionProof {
      let index = entries.findIndex((e) => e.id === evolutionId);
      if (index < 0) throw new Error("Unknown evolution ID");
      const siblings: string[] = [];
      for (const level of levels.slice(0, -1)) {
        siblings.push(level[index ^ 1] ?? level[index]);
        index = Math.floor(index / 2);
      }
      return { evolutionId, siblings };
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
