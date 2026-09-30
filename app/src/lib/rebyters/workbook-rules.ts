import type { BalanceProfile, EvolutionRule, RuleCondition, RuleLevel, MetricProfile } from "./rule-types";
import type { TreeJson } from "./types";

const genes = ["activity", "sociability", "independence", "nocturnal", "carnivore", "herbivore", "piscivore", "frugivore", "size", "strength", "speed", "resilience", "mutation", "rarity"];
const bands = (a: number, b: number, c: number, d: number, max: number): Record<RuleLevel, [number, number]> => ({ low: [a,b-1], medium: [b,c-1], high: [c,d-1], veryHigh: [d,max] });
export function workbookBalance(): BalanceProfile {
  const metrics: Record<string, MetricProfile> = {};
  const add = (key: string, label: string, unit: string, maximum: number, levels: MetricProfile["bands"]) => { metrics[key] = { label, unit, maximum, bands: levels }; };
  for (const gene of genes) add(`genetics.${gene}`, gene[0].toUpperCase()+gene.slice(1), "points", 100, Array.from({ length: 6 }, () => bands(15,35,60,85,100)));
  for (const kind of ["diet", "time"]) {
    for (const name of kind === "diet" ? ["meat", "fish", "plant", "fruit"] : ["morning", "day", "evening", "night"]) add(`${kind}.${name}`, name[0].toUpperCase()+name.slice(1), "%", 100, Array.from({ length: 6 }, () => bands(20,35,60,80,100)));
  }
  add("activity.play", "Play", "sessions", 65535, [1,2,4,8,12,18].map(scale => bands(scale,scale*3,scale*6,scale*10,65535)));
  add("physical.weight", "Weight", "mass units", 65535, [5,10,25,60,120,200].map(base => bands(1,Math.floor(base*.6)+1,base+1,base*2+1,base*4)));
  add("physical.age", "Age", "days", 65535, [1,1,2,4,6,8].map(scale => bands(0,scale*2,scale*4,scale*6,65535)));
  add("progression.cycle", "Completed lives", "cycles", 65535, Array.from({ length: 6 }, () => bands(0,1,2,3,65535)));
  return { version: "mammal-v2.1-balance-1", source: "Rebyters_Mammal_EXE_Evolution_Graph_v2_1.xlsx; numeric presets authored for this development balance", metrics };
}
const condition = (metrics: string[], level: RuleLevel = "medium", test: RuleCondition["test"] = "min"): RuleCondition => ({ metrics, test, level });
function genetics(text: string, stage: number): RuleCondition[][] {
  const expr = text.replace(/\b(bias|balance)\b/g, "").trim();
  const base: RuleLevel = stage >= 4 ? "high" : "medium";
  const alternatives = expr === "rarity + mutation OR nocturnal" ? ["rarity + mutation", "rarity + nocturnal"] : expr.split(" OR ");
  return alternatives.flatMap(alt => {
    let products: RuleCondition[][] = [[]];
    for (const term of alt.split("+").map(t => t.trim())) {
      const choices = term.split("/").map(t => t.trim());
      if (choices.some(g => !genes.includes(g))) throw new Error(`Unknown genetic expression: ${text}`);
      products = products.flatMap(p => choices.map(g => [...p, condition([`genetics.${g}`], base)]));
    }
    return products;
  });
}
function diet(text: string): RuleCondition[][] {
  if (text === "any") return [];
  const foods = ["meat", "fish", "plant", "fruit"];
  const selected = foods.filter(f => text.includes(f));
  const alternatives: RuleCondition[][] = [];
  if (selected.length) alternatives.push([text.includes("dominant") ? { metrics: selected.map(f => `diet.${f}`), test: "min", value: 50 } : condition(selected.map(f => `diet.${f}`), text.includes("helps") ? "low" : selected.length > 1 ? "high" : "medium")]);
  if (text.includes("mixed")) {
    for (let i=0;i<foods.length;i++) for (let j=i+1;j<foods.length;j++) alternatives.push([condition([`diet.${foods[i]}`], "low"), condition([`diet.${foods[j]}`], "low")]);
  }
  if (!alternatives.length) throw new Error(`Unknown diet: ${text}`);
  return alternatives;
}
function activity(text: string): RuleCondition {
  if (text.includes("low-medium") || text.includes("medium-low")) return { ...condition(["activity.play"], "low", "range"), upperLevel: "medium" };
  if (text.includes("medium-high")) return { ...condition(["activity.play"], "medium", "range"), upperLevel: "high" };
  if (text.includes("very high")) return condition(["activity.play"], "veryHigh");
  if (text.includes("high")) return condition(["activity.play"], "high");
  if (text === "play helps") return condition(["activity.play"], "low");
  if (text.includes("medium")) return condition(["activity.play"], "medium", text.includes("+") ? "min" : "range");
  throw new Error(`Unknown activity: ${text}`);
}
function physical(text: string): RuleCondition[] {
  if (text === "any") return [];
  const levels: Record<string, RuleLevel[]> = { "low": ["low"], "light": ["low"], "light-medium": ["low","medium"], "low-medium": ["low","medium"], "medium-low": ["low","medium"], "medium": ["medium"], "medium weight": ["medium"], "medium-heavy": ["medium","high"], "heavy": ["high"], "very heavy": ["veryHigh"] };
  const pair = levels[text];
  if (!pair) throw new Error(`Unknown weight: ${text}`);
  return [{ ...condition(["physical.weight"], pair[0], "range"), ...(pair[1] ? { upperLevel: pair[1] } : {}) }];
}
export function compileWorkbookRule(row: Record<string, string>, stage: number): EvolutionRule {
  const rule: EvolutionRule = { version: 1, requiredGroups: Number(row["Required groups"]), groups: [], mandatory: [], bonuses: [], selection: "player-choice", authoredBy: "workbook+balance" };
  rule.groups.push({ group: 0, alternatives: genetics(row["Genetics group"], stage) });
  const food = diet(row["Diet group"]);
  if (food.length) rule.groups.push({ group: 1, alternatives: food });
  const [time, bonus] = row["Time group"].split(";").map(s => s.trim());
  if (time !== "any") {
    const periods = ["morning", "day", "evening", "night"].filter(p => time.includes(p));
    if (!periods.length) throw new Error(`Unknown time: ${time}`);
    rule.groups.push({ group: 2, alternatives: [[condition(periods.map(p => `time.${p}`), time.includes("helps") ? "low" : periods.length > 1 ? "high" : "medium")]] });
  }
  if (bonus) {
    const period = bonus.replace(" bonus", "");
    if (!["morning", "day", "evening", "night"].includes(period)) throw new Error(`Unknown bonus: ${bonus}`);
    rule.bonuses.push(condition([`time.${period}`], "medium"));
  }
  rule.groups.push({ group: 3, alternatives: [[activity(row["Activity group"])]] });
  const weight = physical(row["Physical group"]);
  if (weight.length) rule.groups.push({ group: 4, alternatives: [weight] });
  if (row["Mandatory gate"] !== "none") {
    for (const gate of row["Mandatory gate"].split(" AND ")) {
      const match = /^(\w+)>=(mid|high|\d+)$/.exec(gate);
      if (!match) throw new Error(`Unknown mandatory gate: ${gate}`);
      const metric = match[1] === "nightRatio" ? "time.night" : match[1] === "play" ? "activity.play" : `genetics.${match[1]}`;
      rule.mandatory.push(match[2] === "mid" || match[2] === "high" ? condition([metric], match[2] === "mid" ? "medium" : "high") : { metrics: [metric], test: "min", value: Number(match[2]) });
    }
  }
  if (Number(row["Min cycle"]) > 0) rule.mandatory.push({ metrics: ["progression.cycle"], test: "min", value: Number(row["Min cycle"]) });
  return rule;
}
export function compileWorkbook(raw: TreeJson): TreeJson {
  return { ...raw, schema: 2, balance: workbookBalance(), evolutions: raw.evolutions.map(e => ({ ...e, paths: e.paths.map(p => {
    const target = raw.evolutions.find(e => e.id === p.target)!;
    if (!p.designRule) throw new Error("Workbook design rule is missing");
    return { target: p.target, designRule: p.designRule, rule: compileWorkbookRule(p.designRule, target.stage) };
  }) })) };
}
