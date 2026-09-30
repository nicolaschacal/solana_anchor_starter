import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { Evolution, TreeJson } from "./types";
import type { RuleCondition } from "./rule-types";
export const utf8 = (value: string) => new TextEncoder().encode(value);
// Restricted JSON: integer numbers, valid Unicode strings, no undefined or floats.
export function canonicalSerialize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalSerialize).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalSerialize((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  throw new Error("Unsupported canonical JSON value");
}
const compare = (a: unknown, b: unknown) => {
  const x = canonicalSerialize(a),
    y = canonicalSerialize(b);
  return x < y ? -1 : x > y ? 1 : 0;
};
export function normalizeEvolution(e: Evolution): Evolution {
  const condition = (c: RuleCondition) => ({ ...c, metrics: [...c.metrics].sort() });
  return {
    ...e,
    paths: e.paths
      .map((p) => ({ ...p,
        ...(p.requirements ? { requirements: [...p.requirements].sort(compare) } : {}),
        ...(p.rule ? { rule: { ...p.rule,
          groups: p.rule.groups.map(g => ({ ...g, alternatives: g.alternatives.map(a => a.map(condition).sort(compare)).sort(compare) })).sort(compare),
          mandatory: p.rule.mandatory.map(condition).sort(compare), bonuses: p.rule.bonuses.map(condition).sort(compare),
        } } : {}),
      }))
      .sort(compare),
  };
}
export function normalizeTree(tree: TreeJson): TreeJson {
  return {
    ...tree,
    evolutions: tree.evolutions
      .map(normalizeEvolution)
      .sort((a, b) => a.id - b.id),
  };
}
export const canonicalTree = (tree: TreeJson) =>
  canonicalSerialize(normalizeTree(tree));
export const contentHash = (tree: TreeJson) =>
  bytesToHex(sha256(utf8(canonicalTree(tree))));
// Bind proofs to schema and family; version is intentionally not part of entry identity.
export const leafBytes = (tree: TreeJson, evolution: Evolution) =>
  utf8(
    canonicalSerialize({
      schema: tree.schema,
      familyId: tree.family.id,
      ...(tree.schema === 2 ? { balanceHash: bytesToHex(sha256(utf8(canonicalSerialize(tree.balance)))) } : {}),
      evolution: normalizeEvolution(evolution),
    }),
  );
