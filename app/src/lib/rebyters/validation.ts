import { z } from "zod";
import { FAMILIES, METRICS, type TreeJson } from "./types";
import { ruleSchema, validateStructuredRules } from "./rule-validation";
const uint = (max: number) => z.number().int().min(0).max(max);
const text = (max: number) =>
  z.string().refine(
    (v) =>
      new TextEncoder().encode(v).length <= max &&
      [...v].every((c) => {
        const n = c.codePointAt(0)!;
        return (n >= 32 && n < 0xd800) || (n > 0xdfff && n <= 0xffff);
      }),
    "Invalid text or UTF-8 byte length",
  );
const requirement = z
  .object({
    group: uint(6),
    metric: uint(255),
    operator: uint(5),
    value: uint(65535),
  })
  .strict()
  .refine(
    (r) => r.metric < METRICS[r.group].length,
    "Invalid metric for group",
  );
const path = z
  .object({
    target: uint(65535),
    requiredGroupCount: uint(7).optional(),
    priority: uint(255).optional(),
    requirements: z.array(requirement).max(32).optional(),
    rule: ruleSchema.optional(),
  })
  .strict()
  .passthrough()
  .refine(
    (p) =>
      p.rule !== undefined || (p.requiredGroupCount !== undefined && p.priority !== undefined && p.requirements !== undefined && p.requiredGroupCount <= new Set(p.requirements.map((r) => r.group)).size),
    "Required group count exceeds distinct groups",
  );
export const treeSchema = z
  .object({
    schema: z.union([z.literal(1), z.literal(2)]),
    family: z.object({ id: uint(7), name: text(48) }).strict(),
    version: z.number().int().min(1).max(4294967294),
    development: z.boolean(),
    evolutions: z
      .array(
        z
          .object({
            id: uint(65535),
            name: text(48).refine((v) => v.trim().length > 0, "Name required"),
            stage: uint(5),
            enabled: z.boolean(),
            initialWeight: uint(65535),
            modelUri: text(512).refine(
              (v) => !v || /^https:\/\/|^ipfs:\/\//.test(v),
              "Model URI must be HTTPS or IPFS",
            ),
            paths: z.array(path).max(16),
          })
          .strict()
          .passthrough(),
      )
      .min(1)
      .max(1000),
  })
  .strict()
  .passthrough();
export function validateTree(input: unknown): TreeJson {
  const tree = treeSchema.parse(input);
  if (tree.family.name !== FAMILIES[tree.family.id])
    throw new Error("Family name does not match ID");
  const ids = new Set(tree.evolutions.map((e) => e.id));
  if (ids.size !== tree.evolutions.length)
    throw new Error("Duplicate evolution ID");
  for (const e of tree.evolutions) {
    if (e.id === 0) throw new Error("Evolution ID has not been reserved");
    const targets = new Set<number>();
    for (const p of e.paths) {
      if (!ids.has(p.target))
        throw new Error(`${e.name}: missing target #${p.target}`);
      if (p.target === e.id) throw new Error(`${e.name}: self-loop`);
      if (targets.has(p.target)) throw new Error(`${e.name}: duplicate target`);
      targets.add(p.target);
    }
  }
  if (tree.schema === 2) validateStructuredRules(tree as TreeJson);
  else if (tree.evolutions.some(e => e.paths.some(p => p.rule))) throw new Error("Structured rules require schema 2");
  return tree as TreeJson;
}
export function warnings(tree: TreeJson): string[] {
  const result: string[] = [];
  if (tree.evolutions.some((e) => !e.modelUri))
    result.push("Some model URIs are empty.");
  if (
    new Set(tree.evolutions.map((e) => e.name.toLowerCase())).size !==
    tree.evolutions.length
  )
    result.push("Duplicate names.");
  const targets = new Set(
    tree.evolutions.flatMap((e) => e.paths.map((p) => p.target)),
  );
  if (tree.evolutions.some((e) => e.stage > 0 && !targets.has(e.id)))
    result.push("Some non-baby forms have no incoming path.");
  return result;
}
export function assertCompatible(previous: TreeJson, next: TreeJson) {
  for (const old of previous.evolutions) {
    const current = next.evolutions.find((e) => e.id === old.id);
    if (!current || current.name !== old.name)
      throw new Error(
        `Keep identity #${old.id} (${old.name}); disable instead of deleting or renaming.`,
      );
  }
}
