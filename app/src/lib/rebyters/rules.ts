import type { EvolutionPath, TreeJson } from "./types";
import { GROUPS } from "./types";
import { LEVELS, type BalanceProfile, type EvolutionRule, type RuleCondition, type RuleLevel } from "./rule-types";

export function conditionBounds(c: RuleCondition, balance: BalanceProfile, stage: number): [number, number] {
  const profile = balance.metrics[c.metrics[0]];
  const band = c.level ? profile.bands[stage][c.level] : undefined;
  const value = band ? (c.test === "max" ? band[1] : band[0]) : c.value!;
  if (c.test === "min") return [value, profile.maximum];
  if (c.test === "max") return [0, value];
  if (c.test === "eq") return [value, value];
  return [value, c.upperLevel ? profile.bands[stage][c.upperLevel][1] : band ? band[1] : c.upper!];
}
export function levelLabel(level: RuleLevel, metric: string) {
  if (metric === "physical.weight") return { low: "Light", medium: "Medium", high: "Heavy", veryHigh: "Very heavy" }[level];
  return { low: "Low", medium: "Medium", high: "High", veryHigh: "Very high" }[level];
}
export function conditionLabel(c: RuleCondition, balance: BalanceProfile): string {
  const label = c.metrics.map(m => balance.metrics[m].label).join(" + ");
  const amount = c.level ? levelLabel(c.level, c.metrics[0]) : String(c.value);
  const upper = c.upperLevel ? levelLabel(c.upperLevel, c.metrics[0]) : c.level ? amount : String(c.upper);
  const test = c.test === "range" ? (amount === upper ? amount : `${amount} to ${upper}`) : c.test === "min" ? `${amount}+` : c.test === "max" ? `At most ${amount}` : `Exactly ${amount}`;
  const unit = !c.level ? ` ${balance.metrics[c.metrics[0]].unit}` : "";
  return `${label}: ${test}${unit}`;
}
export function resolvedLabel(c: RuleCondition, balance: BalanceProfile, stage: number) {
  const [lo, hi] = conditionBounds(c, balance, stage);
  const unit = balance.metrics[c.metrics[0]].unit;
  return `${c.test === "min" ? `>= ${lo}` : c.test === "max" ? `<= ${hi}` : c.test === "eq" ? lo : `${lo}-${hi}`} ${unit}`;
}
export function groupLabel(rule: EvolutionRule, index: number, balance: BalanceProfile) {
  const group = rule.groups[index];
  return `${GROUPS[group.group]}: ${group.alternatives.map(alt => alt.map(c => conditionLabel(c, balance)).join(" AND ")).join(" OR ")}`;
}
export function defaultRule(): EvolutionRule {
  return {
    version: 1,
    requiredGroups: 1,
    groups: [
      { group: 3, alternatives: [[{ metrics: ["care.bond"], test: "min", level: "medium" }]] },
    ],
    mandatory: [
      { metrics: ["battle.attack"], test: "min", level: "medium" },
      { metrics: ["progression.interactions"], test: "min", value: 5 },
      { metrics: ["progression.stageAgeHours"], test: "min", value: 1 },
      { metrics: ["state.sick"], test: "eq", value: 0 },
      { metrics: ["state.injured"], test: "eq", value: 0 },
    ],
    bonuses: [],
    selection: "player-choice",
    authoredBy: "admin",
  };
}
export function metricChoices(balance: BalanceProfile, group?: number) {
  const prefixes = ["genetics.", "diet.", "time.", "care.", "physical.", "progression.", "battle."];
  const keys = Object.keys(balance.metrics).filter(m => group === undefined || m.startsWith(prefixes[group]));
  const choices = keys.map(m => ({ value: m, label: balance.metrics[m].label }));
  for (const prefix of ["diet.", "time."]) {
    const members = keys.filter(m => m.startsWith(prefix));
    for (let mask = 1; mask < 1 << members.length; mask++) {
      const combination = members.filter((_, i) => mask & (1 << i));
      if (combination.length > 1) choices.push({ value: combination.join("+"), label: combination.map(m => balance.metrics[m].label).join(" + ") });
    }
  }
  return choices;
}

export type CreatureState = Record<string, number>;
export function evaluatePath(tree: TreeJson, path: EvolutionPath, state: CreatureState) {
  if (tree.schema !== 2 || !tree.balance || !path.rule) throw new Error("Structured evolution rules are required");
  const balance = tree.balance;
  const target = tree.evolutions.find(e => e.id === path.target);
  if (!target) throw new Error("Missing evolution target");
  const validState = Object.entries(state).every(([metric, value]) => balance.metrics[metric] && Number.isInteger(value) && value >= 0 && value <= balance.metrics[metric].maximum)
    && ["diet.", "time."].every(prefix => Object.entries(state).filter(([m]) => m.startsWith(prefix)).reduce((n, [,v]) => n + v, 0) <= 100);
  const passes = (c: RuleCondition) => {
    if (c.metrics.some(m => state[m] === undefined)) return false;
    const value = c.metrics.reduce((n, m) => n + state[m], 0);
    const [lo, hi] = conditionBounds(c, balance, target.stage);
    return value >= lo && value <= hi;
  };
  const groups = path.rule.groups.map(g => ({ group: g.group, passed: g.alternatives.some(a => a.every(passes)) }));
  const mandatoryPassed = path.rule.mandatory.every(passes);
  const passedGroups = groups.filter(g => g.passed).length;
  return { eligible: validState && target.enabled && mandatoryPassed && passedGroups >= path.rule.requiredGroups, validState, mandatoryPassed, passedGroups, groups, bonusesPassed: path.rule.bonuses.filter(passes).length };
}
export function eligibleEvolutions(tree: TreeJson, sourceId: number, state: CreatureState) {
  const source = tree.evolutions.find(e => e.id === sourceId);
  if (!source?.enabled) return [];
  return source.paths.filter(p => evaluatePath(tree, p, state).eligible).map(p => p.target);
}

export { LEVELS };
