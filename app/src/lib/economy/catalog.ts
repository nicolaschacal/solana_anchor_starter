/**
 * What the store sells. Everything is bought with Gems, the one currency.
 *
 * - Food: four foods in four tiers (plain, good, big, feast). Meals are counters in the player's
 *   profile, never tokens; the free ration and the quests give plain meals, higher tiers are bought.
 * - Training: everyone trains at the normal rate. Machines (standard +50%, pro +100% of the gains of
 *   one training) are tokens in the wallet; the best one held is used automatically.
 * - Evolution items: each turns a Rebyter that has a route to one specific form straight into it,
 *   skipping the requirements. Used up on use.
 * - Decor: fungible, transferable tokens in the wallet, never consumed.
 * - Habitats: 1/1 NFTs that hold their own layout. The first (the 5x5 meadow) comes free in the
 *   starter pack; the rest are bought.
 *
 * The starter decor (tree, rocks, bush) is part of the engine: every player has it, free.
 */

import { DEPLOYMENT } from "./deployment";

export type Climate = "temperate" | "arid" | "cold" | "humid" | "volcanic";
export type StoreCategory = "habitat" | "food" | "machine" | "evolution" | "decor";

type Base = {
  id: string;
  name: string;
  description: string;
  /** Price in whole Gems (for food: one meal). */
  price: number;
  /** Token-2022 mint of decor and machines, once the program has created it. */
  mint: string | null;
  /** Part of the engine: owned by everyone, never sold. */
  starter?: boolean;
};

export type HabitatItem = Base & { category: "habitat"; size: 5 | 7 | 9; climate: Climate };
export type FoodItem = Base & { category: "food"; food: 0 | 1 | 2 | 3; tier: 0 | 1 | 2 | 3 };
export type MachineItem = Base & { category: "machine"; training: 0 | 1 | 2 | 3 | 4 | 5; bonus: string; bonusPct: number };
/** `evoKey` is the key of the form it creates in the atlas; setup resolves it to an evolution id. */
export type EvolutionItem = Base & { category: "evolution"; evoKey: string; stageLabel: string };
export type DecorItem = Base & { category: "decor"; prop: string };
export type StoreItem = HabitatItem | FoodItem | MachineItem | EvolutionItem | DecorItem;

/** Names, in tier order, of the four foods: meat, plants, fish, fruit. */
export const FOOD_NAMES = [
  ["Meat Bite", "Steak", "Big Steak", "Feast Roast"],
  ["Leaves", "Salad", "Garden Bowl", "Harvest Feast"],
  ["Sardine", "Salmon", "Tuna Steak", "Sushi Platter"],
  ["Berries", "Apple", "Fruit Basket", "Golden Fruit"],
];
export const FOOD_GROUPS = ["Meat", "Plants", "Fish", "Fruit"];
/** How much of its fullness a plain meal gives (the program's base table), and the tier multipliers in %. */
const FOOD_BASE_FULLNESS = [22, 16, 18, 14];
export const FOOD_TIER_PCT = [100, 150, 220, 300];
/** How much a meal of each tier counts in the diet history that drives evolution. */
export const FOOD_TIER_DIET = [1, 2, 3, 4];
/** Gem price of one meal, [food][tier]: about the same per point of fullness at every tier. */
const FOOD_PRICE = [
  [4, 6, 9, 12],
  [3, 4, 6, 8],
  [4, 6, 9, 12],
  [3, 4, 6, 8],
];
/** Fullness one meal gives (before the 100 cap). */
export const fullnessOf = (food: number, tier: number) => Math.floor((FOOD_BASE_FULLNESS[food] * FOOD_TIER_PCT[tier]) / 100);
/** Index of a meal in the profile's food counters. */
export const foodSlot = (food: number, tier: number) => food * 4 + tier;
/** The on-chain price table, index food * 4 + tier. */
export const FOOD_PRICES = FOOD_PRICE.flat();

const FOOD_ITEMS: StoreItem[] = FOOD_NAMES.flatMap((names, food) =>
  names.map((name, tier): StoreItem => ({
    id: `food-${["meat", "plants", "fish", "fruit"][food]}-${tier}`,
    category: "food",
    name,
    description: `${FOOD_GROUPS[food]} · fills ${fullnessOf(food, tier)} · counts ×${FOOD_TIER_DIET[tier]} for diet`,
    price: FOOD_PRICE[food][tier],
    mint: null,
    food: food as 0 | 1 | 2 | 3,
    tier: tier as 0 | 1 | 2 | 3,
  })),
);

export const CLIMATES: Record<Climate, { label: string; hint: string }> = {
  temperate: { label: "Temperate", hint: "Balanced for every rebyter" },
  arid: { label: "Arid", hint: "Desert and savanna rebyters thrive" },
  cold: { label: "Cold", hint: "Arctic and mountain rebyters thrive" },
  humid: { label: "Humid", hint: "Forest and water rebyters thrive" },
  volcanic: { label: "Volcanic", hint: "Tough, fiery rebyters thrive" },
};

export type StoreTab = StoreCategory;

export const STORE_CATEGORIES: { id: StoreTab; label: string }[] = [
  { id: "habitat", label: "Habitats" },
  { id: "food", label: "Food" },
  { id: "machine", label: "Training" },
  { id: "evolution", label: "Evolution" },
  { id: "decor", label: "Decor" },
];

const BASE_CATALOG: StoreItem[] = [
  // Habitats
  { id: "habitat-meadow-5", category: "habitat", name: "Verdant Meadow", description: "Your first island, free in the starter pack.", price: 0, mint: null, size: 5, climate: "temperate" },
  { id: "habitat-oasis-10", category: "habitat", name: "Dune Oasis", description: "A wide desert island with palms and warm sand.", price: 2500, mint: null, size: 7, climate: "arid" },
  { id: "habitat-frost-10", category: "habitat", name: "Frostpeak", description: "Snowy ridges and frozen ponds.", price: 2500, mint: null, size: 7, climate: "cold" },
  { id: "habitat-jungle-15", category: "habitat", name: "Rainforest Canopy", description: "A huge, lush island with rivers.", price: 6000, mint: null, size: 9, climate: "humid" },
  { id: "habitat-ember-15", category: "habitat", name: "Ember Crater", description: "A huge island around a sleeping volcano.", price: 6000, mint: null, size: 9, climate: "volcanic" },
  // Food: 4 foods x 4 tiers, bought one meal at a time.
  ...FOOD_ITEMS,
  // Machines (one per training the program already knows)
  { id: "machine-power", category: "machine", name: "Power Press", description: "Heavy lifting for strong bodies.", price: 900, mint: null, training: 0, bonusPct: 50, bonus: "+50% ATK gains from Power training" },
  { id: "machine-endurance", category: "machine", name: "Endurance Track", description: "Long laps build stamina.", price: 900, mint: null, training: 1, bonusPct: 50, bonus: "+50% HP from Endurance training" },
  { id: "machine-defense", category: "machine", name: "Guard Dummy", description: "Practice blocking and bracing.", price: 900, mint: null, training: 2, bonusPct: 50, bonus: "+50% DEF from Defense training" },
  { id: "machine-speed", category: "machine", name: "Sprint Treadmill", description: "Short bursts at full speed.", price: 900, mint: null, training: 3, bonusPct: 50, bonus: "+50% SPD from Speed training" },
  { id: "machine-combat", category: "machine", name: "Sparring Post", description: "Strikes, dodges and footwork.", price: 1200, mint: null, training: 4, bonusPct: 50, bonus: "+50% gains from Combat training" },
  { id: "machine-balance", category: "machine", name: "Balance Beam", description: "A little of everything.", price: 700, mint: null, training: 5, bonusPct: 50, bonus: "+50% gains from Balanced training" },
  // Decor (the engine's own props; the starter ones are free)
  { id: "decor-tree", category: "decor", name: "Oak Tree", description: "Shade for a nap.", price: 0, mint: null, starter: true, prop: "tree" },
  { id: "decor-rocks", category: "decor", name: "Mossy Rocks", description: "A cool place to sit.", price: 0, mint: null, starter: true, prop: "rocks" },
  { id: "decor-bush", category: "decor", name: "Berry Bush", description: "Bright berries all year.", price: 0, mint: null, starter: true, prop: "bush" },
  { id: "decor-pine", category: "decor", name: "Pine Tree", description: "Tall and evergreen.", price: 120, mint: null, prop: "pine" },
  { id: "decor-hero", category: "decor", name: "Great Tree", description: "The landmark of any island.", price: 400, mint: null, prop: "hero" },
  { id: "decor-log", category: "decor", name: "Hollow Log", description: "A hideout for small rebyters.", price: 80, mint: null, prop: "log" },
  { id: "decor-lantern", category: "decor", name: "Enchanted Lantern", description: "A soft glow at night.", price: 250, mint: null, prop: "lantern" },
  { id: "decor-flowers", category: "decor", name: "Wildflowers", description: "A patch of colour.", price: 40, mint: null, prop: "wildflowers" },
  // Appended later (ids come from the position in this list, so these never renumber older items).
  // Pro machines: +100% of the gains of one training.
  { id: "machine-power-pro", category: "machine", name: "Titan Press", description: "Competition-grade lifting rig.", price: 2400, mint: null, training: 0, bonusPct: 100, bonus: "+100% ATK gains from Power training" },
  { id: "machine-endurance-pro", category: "machine", name: "Marathon Loop", description: "A banked track for endless laps.", price: 2400, mint: null, training: 1, bonusPct: 100, bonus: "+100% HP gains from Endurance training" },
  { id: "machine-defense-pro", category: "machine", name: "Bastion Rig", description: "Heavy impact padding and rebound plates.", price: 2400, mint: null, training: 2, bonusPct: 100, bonus: "+100% DEF gains from Defense training" },
  { id: "machine-speed-pro", category: "machine", name: "Gale Track", description: "A downhill sprint lane with wind assist.", price: 2400, mint: null, training: 3, bonusPct: 100, bonus: "+100% SPD gains from Speed training" },
  { id: "machine-combat-pro", category: "machine", name: "Arena Dummy", description: "A full sparring partner.", price: 3200, mint: null, training: 4, bonusPct: 100, bonus: "+100% gains from Combat training" },
  { id: "machine-balance-pro", category: "machine", name: "Zen Platform", description: "Perfect balance, perfect form.", price: 1900, mint: null, training: 5, bonusPct: 100, bonus: "+100% gains from Balanced training" },
  // Evolution items: one form each (rare and ultra forms of the Mammal atlas).
  { id: "evo-spirit_fox", category: "evolution", name: "Spirit Fox Charm", description: "Turns a Rebyter with a route to Spirit Fox into one.", price: 1800, mint: null, evoKey: "spirit_fox", stageLabel: "Rare" },
  { id: "evo-dire_wolf", category: "evolution", name: "Dire Wolf Fang", description: "Turns a Rebyter with a route to Dire Wolf into one.", price: 1800, mint: null, evoKey: "dire_wolf", stageLabel: "Rare" },
  { id: "evo-iron_bear", category: "evolution", name: "Iron Bear Plate", description: "Turns a Rebyter with a route to Iron Bear into one.", price: 1800, mint: null, evoKey: "iron_bear", stageLabel: "Rare" },
  { id: "evo-titan_ape", category: "evolution", name: "Titan Ape Idol", description: "Turns a Rebyter with a route to Titan Ape into one.", price: 1800, mint: null, evoKey: "titan_ape", stageLabel: "Rare" },
  { id: "evo-sky_courser", category: "evolution", name: "Sky Courser Feather", description: "Turns a Rebyter with a route to Sky Courser into one.", price: 1800, mint: null, evoKey: "sky_courser", stageLabel: "Rare" },
  { id: "evo-mammoth", category: "evolution", name: "Mammoth Tusk", description: "Turns a Rebyter with a route to Mammoth into one.", price: 1800, mint: null, evoKey: "mammoth", stageLabel: "Rare" },
  { id: "evo-kitsune", category: "evolution", name: "Kitsune Seal", description: "Turns a Rebyter with a route to Kitsune into one.", price: 4500, mint: null, evoKey: "kitsune", stageLabel: "Ultra" },
  { id: "evo-fenrir", category: "evolution", name: "Fenrir Chain", description: "Turns a Rebyter with a route to Fenrir into one.", price: 4500, mint: null, evoKey: "fenrir", stageLabel: "Ultra" },
  { id: "evo-behemoth", category: "evolution", name: "Behemoth Horn", description: "Turns a Rebyter with a route to Behemoth into one.", price: 4500, mint: null, evoKey: "behemoth", stageLabel: "Ultra" },
  { id: "evo-leviathan", category: "evolution", name: "Leviathan Scale", description: "Turns a Rebyter with a route to Leviathan into one.", price: 4500, mint: null, evoKey: "leviathan", stageLabel: "Ultra" },
];

/** The catalog with the mints the economy setup created (see deployment.json). */
export const CATALOG: StoreItem[] = BASE_CATALOG.map((item) => ({ ...item, mint: DEPLOYMENT.items[item.id]?.mint ?? item.mint }));

/** The on-chain item id of a catalog item, or null while it is not registered. */
export const itemIdOf = (item: StoreItem): number | null => DEPLOYMENT.items[item.id]?.itemId ?? null;

export const itemsIn = (category: StoreCategory) => CATALOG.filter((item) => item.category === category);

/**
 * Catalog items that exist as an on-chain item type, in the order that fixes their ids (100 + position):
 * habitats and sellable decor and machines. Food is a counter, and starter decor is free. Append only.
 */
export const registrable = BASE_CATALOG.filter((item) => item.category !== "food" && !(item.starter && item.category !== "habitat"));

/** The evolution item (if any) that turns a Rebyter into the form with this evolution id. */
export const evolutionItemFor = (evolutionId: number): StoreItem | undefined =>
  CATALOG.find((item) => item.category === "evolution" && DEPLOYMENT.items[item.id]?.evoTarget === evolutionId);

/** The catalog id of the habitat given by the starter pack. */
/** The habitat kind with this on-chain item id. */
export const habitatOf = (itemId: number): HabitatItem | undefined =>
  CATALOG.find((i): i is HabitatItem => i.category === "habitat" && DEPLOYMENT.items[i.id]?.itemId === itemId);

export const STARTER_HABITAT_ID = "habitat-meadow-5";
