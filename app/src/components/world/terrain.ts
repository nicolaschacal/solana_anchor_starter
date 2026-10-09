import { CENTRE_TILE, CLIFF_LEVEL, GX, GZ } from "../admin/habitat/grid";
import type { TileData } from "../admin/habitat/tiles";
import type { Climate } from "../../lib/economy/catalog";

/** Tiles per side of an island: small, medium and large. */
export type IslandSize = 5 | 7 | 9;

const index = (i: number, j: number) => j * GX + i;
/** The tiles an island covers, centred on the middle of the diorama. */
export const islandRegion = (size: number) => {
  const i0 = CENTRE_TILE.i - Math.floor(size / 2);
  const j0 = CENTRE_TILE.j - Math.floor(size / 2);
  return { i0, j0, i1: i0 + size - 1, j1: j0 + size - 1 };
};

type Cell = [number, number];
const GROUND = { grass: 0, path: 1, sand: 2, rock: 3 } as const;

const rect = (x0: number, y0: number, x1: number, y1: number): Cell[] => {
  const out: Cell[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
};
const disc = (cx: number, cy: number, r2: number): Cell[] => {
  const out: Cell[] = [];
  for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) if (x * x + y * y <= r2) out.push([cx + x, cy + y]);
  return out;
};

type Plan = { ground?: { cells: Cell[]; kind: keyof typeof GROUND }[]; floor?: keyof typeof GROUND; water?: Cell[]; level?: { cells: Cell[]; level: number }[] };

/**
 * The land of each island: fixed, so what it holds is a property of the habitat itself. Water and cliffs
 * take space away from the flat island; the coordinates are local to the board (0..size-1).
 */
const PLANS: Partial<Record<`${Climate}-${IslandSize}`, Plan>> = {
  // Dune Oasis: sand, a pond and a couple of dunes.
  "arid-7": {
    floor: "sand",
    water: rect(4, 1, 5, 3),
    level: [{ cells: [[0, 4], [0, 5], [1, 6]], level: 3 }],
  },
  // Frostpeak: a rocky ridge and a frozen pond.
  "cold-7": {
    floor: "grass",
    water: [[5, 4], [5, 5], [4, 5]],
    level: [{ cells: [[1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [0, 3], [1, 3], [0, 4]], level: 4 }],
    ground: [{ cells: rect(0, 0, 4, 4), kind: "rock" }],
  },
  // Rainforest Canopy: a river winding across.
  "humid-9": {
    floor: "grass",
    water: [[2, 0], [2, 1], [2, 2], [2, 3], [3, 3], [3, 4], [3, 5], [4, 5], [4, 6], [5, 6], [5, 7], [6, 7], [6, 8], [7, 8]],
    ground: [{ cells: [[7, 1], [8, 1], [7, 2]], kind: "path" }],
  },
  // Ember Crater: a big cone and a small peak.
  "volcanic-9": {
    floor: "rock",
    level: [
      { cells: disc(6, 2, 8), level: 4 },
      { cells: [[1, 7], [0, 7], [2, 7], [1, 6], [1, 8]], level: 3 },
    ],
    ground: [{ cells: rect(0, 0, 8, 8).filter(([x, y]) => (x * 7 + y * 3) % 5 === 0), kind: "grass" }],
  },
};

/** The tile data of an island (same shape the habitat engine loads), or null for flat grass. */
export function terrainFor(climate: Climate, size: IslandSize): TileData | null {
  const plan = PLANS[`${climate}-${size}`];
  if (!plan) return null;
  const r = islandRegion(size);
  const at = ([x, y]: Cell) => index(r.i0 + x, r.j0 + y);
  const ground = new Uint8Array(GX * GZ);
  const level = new Uint8Array(GX * GZ);
  const water = new Uint8Array(GX * GZ);
  if (plan.floor && plan.floor !== "grass") {
    for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) ground[index(i, j)] = GROUND[plan.floor];
  }
  for (const g of plan.ground ?? []) for (const c of g.cells) if (c[0] >= 0 && c[1] >= 0 && c[0] < size && c[1] < size) ground[at(c)] = GROUND[g.kind];
  for (const l of plan.level ?? []) for (const c of l.cells) if (c[0] >= 0 && c[1] >= 0 && c[0] < size && c[1] < size) level[at(c)] = l.level;
  for (const c of plan.water ?? []) water[at(c)] = 1;
  const text = (a: Uint8Array) => Array.from(a).join("");
  return { ground: text(ground), level: text(level), water: text(water), cut: "0".repeat(GX * GZ) };
}

/** Whether a tile of the island can be stood on: dry and not a cliff. */
export function tileIsFree(tiles: TileData | null, i: number, j: number): boolean {
  if (!tiles) return true;
  const k = index(i, j);
  return tiles.water[k] !== "1" && Number(tiles.level[k]) < CLIFF_LEVEL;
}


/** How many rebyters and objects an island holds: a ceiling by size, lowered by its land. */
export const REBYTERS_BY_SIZE: Record<IslandSize, number> = { 5: 3, 7: 5, 9: 8 };
export const PROPS_BY_SIZE: Record<IslandSize, number> = { 5: 14, 7: 24, 9: 40 };

export function freeTileCount(tiles: TileData | null, size: IslandSize) {
  const r = islandRegion(size);
  let n = 0;
  for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) if (tileIsFree(tiles, i, j)) n++;
  return n;
}

/**
 * What an island holds: fixed by its size (and registered on chain with the habitat kind). The land
 * (water, cliffs) does not lower it yet; `freeTiles` is only informative.
 */
export function islandCapacity(size: IslandSize, climate: Climate) {
  return {
    freeTiles: freeTileCount(terrainFor(climate, size), size),
    maxPlaced: REBYTERS_BY_SIZE[size],
    maxProps: PROPS_BY_SIZE[size],
  };
}
