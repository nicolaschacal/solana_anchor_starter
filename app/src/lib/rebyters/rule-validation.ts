import { z } from "zod";
import type { TreeJson } from "./types";
import type { RuleCondition } from "./rule-types";
import { conditionBounds } from "./rules";

const uint = z.number().int().min(0).max(65535);
const level = z.enum(["low", "medium", "high", "veryHigh"]);
const band = z.tuple([uint,uint]).refine(([lo,hi]) => lo <= hi, "Invalid preset band");
const bands = z.object({ low: band, medium: band, high: band, veryHigh: band }).strict();
export const balanceSchema = z.object({
  version: z.string().min(1).max(80), source: z.string().min(1).max(512),
  metrics: z.record(z.object({ label: z.string().min(1).max(60), unit: z.string().max(20), maximum: uint, bands: z.array(bands).length(6) }).strict()),
}).strict();
const condition = z.object({
  metrics: z.array(z.string().min(1).max(64)).min(1).max(4),
  test: z.enum(["min","max","range","eq"]), level: level.optional(), upperLevel: level.optional(), value: uint.optional(), upper: uint.optional(),
}).strict().superRefine((c,ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if ((c.level !== undefined) === (c.value !== undefined)) fail("Choose a preset or an exact threshold");
  if (new Set(c.metrics).size !== c.metrics.length) fail("Duplicate metric");
  if (c.test === "eq" && c.level) fail("Exact tests need a numeric value");
  if (c.test !== "range" && (c.upper !== undefined || c.upperLevel)) fail("Upper bounds require a range");
  if (c.test === "range" && !c.level && c.upper === undefined) fail("Numeric ranges need both bounds");
  if ((c.level && c.upper !== undefined) || (!c.level && c.upperLevel)) fail("Do not mix numeric and preset range bounds");
});
export const ruleSchema = z.object({
  version: z.literal(1), requiredGroups: z.number().int().min(0).max(7),
  groups: z.array(z.object({ group: z.number().int().min(0).max(6), alternatives: z.array(z.array(condition).min(1).max(16)).min(1).max(16) }).strict()).max(7),
  mandatory: z.array(condition).max(16), bonuses: z.array(condition).max(16), selection: z.literal("player-choice"), authoredBy: z.enum(["workbook+balance","admin"]),
}).strict().superRefine((r,ctx) => {
  if (r.requiredGroups > r.groups.length || (r.groups.length && r.requiredGroups === 0) || (!r.groups.length && !r.mandatory.length)) ctx.addIssue({ code: "custom", message: "Choose at least one required category or a mandatory gate; configured categories cannot be ignored" });
  if (new Set(r.groups.map(g => g.group)).size !== r.groups.length) ctx.addIssue({ code: "custom", message: "Duplicate rule category" });
});
export function validateStructuredRules(tree: TreeJson) {
  const balance = balanceSchema.parse(tree.balance);
  const prefixes = ["genetics.","diet.","time.","care.","physical.","progression.","battle."];
  if (!Object.keys(balance.metrics).length) throw new Error("Balance metrics are empty");
  for (const [metric, profile] of Object.entries(balance.metrics)) {
    if (!metric.includes(".")) throw new Error(`Invalid balance metric ${metric}`);
    for (const stage of profile.bands) {
      let last = -1;
      for (const band of [stage.low,stage.medium,stage.high,stage.veryHigh]) {
        if (band[0] <= last || band[1] > profile.maximum) throw new Error(`Overlapping or out-of-bounds presets: ${metric}`);
        last = band[1];
      }
    }
  }
  for (const e of tree.evolutions) for (const path of e.paths) {
    if (path.requirements !== undefined || path.priority !== undefined || path.requiredGroupCount !== undefined) throw new Error("Schema 2 cannot contain legacy requirements or priority");
    const rule = ruleSchema.parse(path.rule);
    const target = tree.evolutions.find(t => t.id === path.target)!;
    if (target.stage !== e.stage + 1) throw new Error(`${e.name}: evolution must advance exactly one stage`);
    const check = (c: RuleCondition, prefix?: string) => {
      if (c.metrics.some(m => !balance.metrics[m] || (prefix && !m.startsWith(prefix)))) throw new Error(`${e.name}: invalid metric for category`);
      if (c.metrics.length > 1 && !["diet.","time."].some(p => c.metrics.every(m => m.startsWith(p)))) throw new Error("Only diet/time percentages can be combined");
      const [lo,hi] = conditionBounds(c, balance, target.stage);
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi || hi > balance.metrics[c.metrics[0]].maximum) throw new Error(`${e.name}: invalid condition bounds`);
    };
    rule.groups.forEach(g => g.alternatives.forEach(alt => alt.forEach(c => check(c, prefixes[g.group]))));
    rule.mandatory.forEach(c => check(c));
    rule.bonuses.forEach(c => check(c));
  }
}
