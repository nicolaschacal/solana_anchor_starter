import type { BalanceProfile, EvolutionRule } from "./rule-types";
export const FAMILIES = [
  "Mammal",
  "Aquatic",
  "Avian",
  "Reptile",
  "Insect",
  "Plant",
  "Humanoid",
  "Mythic",
] as const;
export const STAGES = ["BIT", "BYTE", "KYLO", "MEGA", "GIGA", "TERA"];
export const GROUPS = [
  "Genetics",
  "Diet",
  "Time",
  "Activity",
  "Physical",
  "Progression",
  "Battle",
];
export const OPERATORS = ["=", "!=", ">", ">=", "<", "<="];
export const METRICS = [
  [
    "ActivityGene",
    "SociabilityGene",
    "IndependenceGene",
    "NocturnalGene",
    "CarnivoreGene",
    "HerbivoreGene",
    "PiscivoreGene",
    "FrugivoreGene",
    "SizeGene",
    "StrengthGene",
    "SpeedGene",
    "ResilienceGene",
    "MutationGene",
    "RarityGene",
  ],
  ["Meat", "Fish", "Plant", "Fruit"],
  ["Morning", "Day", "Evening", "Night"],
  ["Play"],
  ["Weight", "Age"],
  ["Cycle", "Level", "XP"],
  ["Wins", "Losses", "HP", "Attack", "Defense", "Speed"],
];
export interface Requirement {
  group: number;
  metric: number;
  operator: number;
  value: number;
}
export interface EvolutionPath {
  target: number;
  requiredGroupCount?: number;
  priority?: number;
  requirements?: Requirement[];
  rule?: EvolutionRule;
  designRule?: Record<string, string>;
}
export type EvolutionRarity = "common" | "uncommon" | "rare" | "ultra";
export interface EvolutionAssets {
  metadataUri?: string;
  imageUri?: string;
  thumbnailUri?: string;
  modelUri?: string;
}
export interface EvolutionPosition {
  x: number;
  y: number;
}
export interface Evolution {
  id: number;
  key?: string;
  name: string;
  description?: string;
  stage: number;
  family?: string;
  rarity?: EvolutionRarity;
  visualDescription?: string;
  enabled: boolean;
  initialWeight: number;
  modelUri: string;
  assets?: EvolutionAssets;
  position?: EvolutionPosition;
  paths: EvolutionPath[];
}
export interface TreeJson {
  schema: 1 | 2;
  balance?: BalanceProfile;
  family: { id: number; name: string };
  version: number;
  development: boolean;
  evolutions: Evolution[];
}
export interface Publication {
  uri: string;
  contentHash: string;
  merkleRoot: string;
}
export interface TreeMetadata extends Publication {
  familyId: number;
  version: number;
  address: string;
  createdAt: number;
}
export interface Registry {
  authority: string;
  nextEvolutionId: number;
  activeVersions: number[];
  nextVersions: number[];
}
