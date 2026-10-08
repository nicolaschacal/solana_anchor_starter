/**
 * What the store sells. Every item becomes a Token-2022 mint created by the game program
 * in phase 2 of the economy plan; until then `mint` is null and the store shows prices only.
 *
 * - Food: fungible, 0 decimals, burnt when fed (99 meat − 5 fed = 94 in the wallet).
 * - Machines and decor: fungible, 0 decimals, never consumed.
 * - Habitats: 1/1 NFTs with a fixed size and climate.
 *
 * The 5x5 meadow and the starter decor are part of the engine: every player has them, free.
 */

export type Climate = "temperate" | "arid" | "cold" | "humid" | "volcanic";
export type StoreCategory = "habitat" | "food" | "machine" | "decor";

type Base = {
  id: string;
  name: string;
  description: string;
  /** Price in whole $RBTYR. */
  price: number;
  /** Token-2022 mint, once the program has created it. */
  mint: string | null;
  /** Part of the engine: owned by everyone, never sold. */
  starter?: boolean;
};

export type HabitatItem = Base & { category: "habitat"; size: 5 | 10 | 15; climate: Climate; slots: number };
export type FoodItem = Base & { category: "food"; food: 0 | 1 | 2 | 3; pack: number };
export type MachineItem = Base & { category: "machine"; training: 0 | 1 | 2 | 3 | 4 | 5; bonus: string };
export type DecorItem = Base & { category: "decor"; prop: string };
export type StoreItem = HabitatItem | FoodItem | MachineItem | DecorItem;

export const CLIMATES: Record<Climate, { label: string; hint: string }> = {
  temperate: { label: "Temperate", hint: "Balanced for every rebyter" },
  arid: { label: "Arid", hint: "Desert and savanna rebyters thrive" },
  cold: { label: "Cold", hint: "Arctic and mountain rebyters thrive" },
  humid: { label: "Humid", hint: "Forest and water rebyters thrive" },
  volcanic: { label: "Volcanic", hint: "Tough, fiery rebyters thrive" },
};

export const STORE_CATEGORIES: { id: StoreCategory; label: string }[] = [
  { id: "habitat", label: "Habitats" },
  { id: "food", label: "Food" },
  { id: "machine", label: "Machines" },
  { id: "decor", label: "Decor" },
];

export const CATALOG: StoreItem[] = [
  // Habitats
  { id: "habitat-meadow-5", category: "habitat", name: "Verdant Meadow", description: "Your first island. Every player has one.", price: 0, mint: null, starter: true, size: 5, climate: "temperate", slots: 3 },
  { id: "habitat-oasis-10", category: "habitat", name: "Dune Oasis", description: "A wide desert island with palms and warm sand.", price: 2500, mint: null, size: 10, climate: "arid", slots: 6 },
  { id: "habitat-frost-10", category: "habitat", name: "Frostpeak", description: "Snowy ridges and frozen ponds.", price: 2500, mint: null, size: 10, climate: "cold", slots: 6 },
  { id: "habitat-jungle-15", category: "habitat", name: "Rainforest Canopy", description: "A huge, lush island with rivers.", price: 6000, mint: null, size: 15, climate: "humid", slots: 10 },
  { id: "habitat-ember-15", category: "habitat", name: "Ember Crater", description: "A huge island around a sleeping volcano.", price: 6000, mint: null, size: 15, climate: "volcanic", slots: 10 },
  // Food (the four meals the program already knows)
  { id: "food-meat-10", category: "food", name: "Meat ×10", description: "Builds carnivore history.", price: 40, mint: null, food: 0, pack: 10 },
  { id: "food-plants-10", category: "food", name: "Plants ×10", description: "Builds herbivore history.", price: 30, mint: null, food: 1, pack: 10 },
  { id: "food-fish-10", category: "food", name: "Fish ×10", description: "Builds piscivore history.", price: 40, mint: null, food: 2, pack: 10 },
  { id: "food-fruit-10", category: "food", name: "Fruit ×10", description: "Builds frugivore history.", price: 30, mint: null, food: 3, pack: 10 },
  { id: "food-meat-99", category: "food", name: "Meat ×99", description: "A full larder for carnivores.", price: 350, mint: null, food: 0, pack: 99 },
  // Machines (one per training the program already knows)
  { id: "machine-power", category: "machine", name: "Power Press", description: "Heavy lifting for strong bodies.", price: 900, mint: null, training: 0, bonus: "+50% ATK from Power training" },
  { id: "machine-endurance", category: "machine", name: "Endurance Track", description: "Long laps build stamina.", price: 900, mint: null, training: 1, bonus: "+50% HP from Endurance training" },
  { id: "machine-defense", category: "machine", name: "Guard Dummy", description: "Practice blocking and bracing.", price: 900, mint: null, training: 2, bonus: "+50% DEF from Defense training" },
  { id: "machine-speed", category: "machine", name: "Sprint Treadmill", description: "Short bursts at full speed.", price: 900, mint: null, training: 3, bonus: "+50% SPD from Speed training" },
  { id: "machine-combat", category: "machine", name: "Sparring Post", description: "Strikes, dodges and footwork.", price: 1200, mint: null, training: 4, bonus: "+50% gains from Combat training" },
  { id: "machine-balance", category: "machine", name: "Balance Beam", description: "A little of everything.", price: 700, mint: null, training: 5, bonus: "+50% gains from Balanced training" },
  // Decor (the engine's own props; the starter ones are free)
  { id: "decor-tree", category: "decor", name: "Oak Tree", description: "Shade for a nap.", price: 0, mint: null, starter: true, prop: "tree" },
  { id: "decor-rocks", category: "decor", name: "Mossy Rocks", description: "A cool place to sit.", price: 0, mint: null, starter: true, prop: "rocks" },
  { id: "decor-bush", category: "decor", name: "Berry Bush", description: "Bright berries all year.", price: 0, mint: null, starter: true, prop: "bush" },
  { id: "decor-pine", category: "decor", name: "Pine Tree", description: "Tall and evergreen.", price: 120, mint: null, prop: "pine" },
  { id: "decor-hero", category: "decor", name: "Great Tree", description: "The landmark of any island.", price: 400, mint: null, prop: "hero" },
  { id: "decor-log", category: "decor", name: "Hollow Log", description: "A hideout for small rebyters.", price: 80, mint: null, prop: "log" },
  { id: "decor-lantern", category: "decor", name: "Enchanted Lantern", description: "A soft glow at night.", price: 250, mint: null, prop: "lantern" },
  { id: "decor-flowers", category: "decor", name: "Wildflowers", description: "A patch of colour.", price: 40, mint: null, prop: "wildflowers" },
];

export const itemsIn = (category: StoreCategory) => CATALOG.filter((item) => item.category === category);
