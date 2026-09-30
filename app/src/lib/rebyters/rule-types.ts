export const LEVELS = ["low", "medium", "high", "veryHigh"] as const;
export type RuleLevel = (typeof LEVELS)[number];
export interface RuleCondition {
  metrics: string[];
  test: "min" | "max" | "range" | "eq";
  level?: RuleLevel;
  upperLevel?: RuleLevel;
  value?: number;
  upper?: number;
}
export interface RuleGroup {
  group: number;
  // OR between alternatives; AND within one alternative.
  alternatives: RuleCondition[][];
}
export interface EvolutionRule {
  version: 1;
  requiredGroups: number;
  groups: RuleGroup[];
  mandatory: RuleCondition[];
  bonuses: RuleCondition[];
  selection: "player-choice";
  authoredBy: "workbook+balance" | "admin";
}
export interface MetricProfile {
  label: string;
  unit: string;
  maximum: number;
  bands: Record<RuleLevel, [number, number]>[];
}
export interface BalanceProfile {
  version: string;
  source: string;
  metrics: Record<string, MetricProfile>;
}
