import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils";
import { conditionBounds } from "./rules";
import type { EvolutionPath, TreeJson } from "./types";
import type { RuleCondition } from "./rule-types";

const METRIC_IDS: Record<string, number> = {
  "genetics.activity": 0,
  "genetics.sociability": 1,
  "genetics.independence": 2,
  "genetics.nocturnal": 3,
  "genetics.carnivore": 4,
  "genetics.herbivore": 5,
  "genetics.piscivore": 6,
  "genetics.frugivore": 7,
  "genetics.size": 8,
  "genetics.strength": 9,
  "genetics.speed": 10,
  "genetics.resilience": 11,
  "genetics.mutation": 12,
  "genetics.rarity": 13,
  "diet.meat": 14,
  "diet.fish": 15,
  "diet.plant": 16,
  "diet.fruit": 17,
  "time.morning": 18,
  "time.day": 19,
  "time.evening": 20,
  "time.night": 21,
  "activity.play": 22,
  "physical.weight": 23,
  "progression.cycle": 24,
};

function u16(value: number) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, value, true);
  return b;
}
function u32(value: number) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, value, true);
  return b;
}
function conditionBytes(
  tree: TreeJson,
  targetStage: number,
  condition: RuleCondition,
) {
  if (!tree.balance) throw new Error("Structured balance is required");
  const metrics = condition.metrics.map((name) => {
    const metric = METRIC_IDS[name];
    if (metric === undefined)
      throw new Error(`Unsupported on-chain metric: ${name}`);
    return metric;
  });
  if (!metrics.length || metrics.length > 16)
    throw new Error("Evolution condition metric count is invalid");
  const [lo, hi] = conditionBounds(condition, tree.balance, targetStage);
  const test = condition.test === "min" ? 0
    : condition.test === "range" ? 1
    : condition.test === "max" ? 2
    : 3;
  if (lo < 0 || hi < 0 || lo > 65535 || hi > 65535)
    throw new Error("Evolution threshold exceeds u16");
  return concatBytes(
    Uint8Array.of(metrics.length),
    Uint8Array.from(metrics),
    Uint8Array.of(test),
    u16(lo),
    u16(hi),
  );
}

export function encodeRule(
  tree: TreeJson,
  path: EvolutionPath,
  targetStage: number,
) {
  if (!path.rule) throw new Error("Structured evolution rule is required");
  const chunks: Uint8Array[] = [
    Uint8Array.of(1, path.rule.requiredGroups, path.rule.groups.length),
  ];
  for (const group of path.rule.groups) {
    chunks.push(Uint8Array.of(group.group, group.alternatives.length));
    for (const alternative of group.alternatives) {
      chunks.push(Uint8Array.of(alternative.length));
      for (const condition of alternative)
        chunks.push(conditionBytes(tree, targetStage, condition));
    }
  }
  chunks.push(Uint8Array.of(path.rule.mandatory.length));
  for (const condition of path.rule.mandatory)
    chunks.push(conditionBytes(tree, targetStage, condition));
  return concatBytes(...chunks);
}

function encodeLeafPreimage(
  tree: TreeJson,
  sourceId: number,
  path: EvolutionPath,
) {
  const target = tree.evolutions.find((e) => e.id === path.target);
  if (!target) throw new Error("Missing evolution target");
  const name = new TextEncoder().encode(target.name);
  const uri = new TextEncoder().encode(target.assets?.metadataUri ?? "");
  const rule = encodeRule(tree, path, target.stage);
  if (name.length > 255 || uri.length > 65535 || rule.length > 65535)
    throw new Error("Evolution rule leaf exceeds encoding limits");
  return concatBytes(
    Uint8Array.of(2, tree.family.id),
    u32(tree.version),
    u16(sourceId),
    u16(target.id),
    Uint8Array.of(target.stage, name.length),
    name,
    u16(uri.length),
    uri,
    u16(rule.length),
    rule,
  );
}

export function ruleLeafHash(
  tree: TreeJson,
  sourceId: number,
  path: EvolutionPath,
) {
  return bytesToHex(sha256(encodeLeafPreimage(tree, sourceId, path)));
}

function parent(a: string, b: string) {
  const [left, right] = [a, b].sort();
  return bytesToHex(
    sha256(concatBytes(Uint8Array.of(1), hexToBytes(left), hexToBytes(right))),
  );
}

export function buildRuleMerkleTree(tree: TreeJson) {
  if (tree.schema !== 2 || !tree.balance)
    throw new Error("Schema 2 structured rules are required");
  const entries = tree.evolutions
    .flatMap((source) => source.paths.map((path) => ({ source, path })))
    .filter(({ path }) => !!path.rule)
    .sort((a, b) => a.source.id - b.source.id || a.path.target - b.path.target);
  if (!entries.length) throw new Error("Atlas has no structured evolution rules");
  const levels: string[][] = [
    entries.map(({ source, path }) => ruleLeafHash(tree, source.id, path)),
  ];
  while (levels.at(-1)!.length > 1) {
    const current = levels.at(-1)!;
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2)
      next.push(parent(current[i], current[i + 1] ?? current[i]));
    levels.push(next);
  }
  return {
    root: levels.at(-1)![0],
    getProof(sourceId: number, targetId: number) {
      let index = entries.findIndex(
        ({ source, path }) => source.id === sourceId && path.target === targetId,
      );
      if (index < 0) throw new Error("Unknown evolution path");
      const siblings: string[] = [];
      for (const level of levels.slice(0, -1)) {
        siblings.push(level[index ^ 1] ?? level[index]);
        index = Math.floor(index / 2);
      }
      const entry = entries.find(
        ({ source, path }) => source.id === sourceId && path.target === targetId,
      )!;
      const target = tree.evolutions.find((e) => e.id === targetId)!;
      return {
        siblings,
        ruleBytes: encodeRule(tree, entry.path, target.stage),
        target,
      };
    },
  };
}
