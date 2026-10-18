import { OX, OZ } from "../admin/habitat/tiles";
import { HabitatWorld } from "../admin/habitat/world";
import type { TileData } from "../admin/habitat/tiles";
import type { Climate } from "../../lib/economy/catalog";
import { islandCapacity, islandRegion, terrainFor, tileIsFree, type IslandSize } from "./terrain";
import type { AssetKey } from "../assets/meadow";

export type PlacedRebyter = { mint: string; i: number; j: number };
export type PlacedProp = { key: AssetKey; x: number; z: number; h: number; r: number };
/** `props: null` means the player never saved a layout: the world shows its default scene. */
export type WorldLayout = { v: 1; placed: PlacedRebyter[]; props: PlacedProp[] | null };

export type HabitatSize = IslandSize;

/** What an island holds: its size fixes it (3, 5 or 8 rebyters; 14, 24 or 40 objects), as registered on chain. */
export type HabitatSpec = {
  size: HabitatSize;
  climate: Climate;
  board: { i0: number; i1: number; j0: number; j1: number };
  /** Tiles of the island that can be stood on. */
  freeTiles: number;
  /** Most rebyters (heads), as the program checks. */
  maxPlaced: number;
  /** Ground room for rebyters, in tiles (a 2×2 takes 4). */
  maxTiles: number;
  maxProps: number;
  /** The land (null = flat grass) and whether a tile of it can be stood on. */
  tiles: TileData | null;
  free: (i: number, j: number) => boolean;
  /** The tile the default tree stands on. */
  tree: { i: number; j: number };
  /** Where the first rebyters start: spread out, away from the tree in the corner. */
  start: [number, number][];
};

export function specFor(size: HabitatSize, climate: Climate = "temperate"): HabitatSpec {
  const r = islandRegion(size);
  const board = { i0: r.i0, i1: r.i1, j0: r.j0, j1: r.j1 };
  const tiles = terrainFor(climate, size);
  const free = (i: number, j: number) => i >= board.i0 && i <= board.i1 && j >= board.j0 && j <= board.j1 && tileIsFree(tiles, i, j);
  const { freeTiles, maxPlaced, maxTiles, maxProps } = islandCapacity(size, climate);
  const c = Math.floor(size / 2);
  const start: [number, number][] = [
    [board.i0 + c, board.j0 + c],
    [board.i1 - 1, board.j1 - 1],
    [board.i0 + 1, board.j1 - 1],
    [board.i1 - 1, board.j0 + c],
  ];
  return {
    size,
    climate,
    board,
    freeTiles,
    maxPlaced,
    maxTiles,
    maxProps,
    tiles,
    free,
    tree: { i: board.i0, j: board.j0 },
    start,
  };
}

/** The starter island: 5x5. */
export const DEFAULT_SPEC = specFor(5);

export const tileX = (i: number) => OX + i;
export const tileZ = (j: number) => OZ + j;
export const onBoard = (i: number, j: number, spec: HabitatSpec = DEFAULT_SPEC) =>
  i >= spec.board.i0 && i <= spec.board.i1 && j >= spec.board.j0 && j <= spec.board.j1;

/**
 * The first free starting tile for a new arrival: the corner tile of a `w × d` footprint (1 × 1 by default)
 * whose every tile is on the island, free and not taken. `taken` lists tiles already covered.
 */
export function freeTile(taken: { i: number; j: number }[], blocked: (i: number, j: number) => boolean, spec: HabitatSpec = DEFAULT_SPEC, w = 1, d = 1) {
  const used = new Set(taken.map((t) => `${t.i},${t.j}`));
  const candidates: [number, number][] = [...spec.start];
  for (let i = spec.board.i0; i <= spec.board.i1; i++) for (let j = spec.board.j0; j <= spec.board.j1; j++) candidates.push([i, j]);
  const ok = (i: number, j: number) => !used.has(`${i},${j}`) && spec.free(i, j) && !blocked(i, j);
  const found = candidates.find(([i, j]) => {
    for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) if (!ok(i + a, j + b)) return false;
    return true;
  });
  return found ? { i: found[0], j: found[1] } : null;
}

/** Every tile the placed rebyters cover, given each one's footprint. */
export function coveredBy(placed: PlacedRebyter[], footprintOf: (mint: string) => { w: number; d: number }) {
  return placed.flatMap((p) => {
    const f = footprintOf(p.mint);
    const out: { i: number; j: number }[] = [];
    for (let a = 0; a < f.w; a++) for (let b = 0; b < f.d; b++) out.push({ i: p.i + a, j: p.j + b });
    return out;
  });
}

/** The layout to start from: the first rebyters on the first free tiles, within the island's room. */
export function defaultLayout(mints: string[], spec: HabitatSpec = DEFAULT_SPEC, tilesOf: (mint: string) => number = () => 1): WorldLayout {
  const placed: PlacedRebyter[] = [];
  let room = spec.maxTiles;
  mints.forEach((mint) => {
    const cost = tilesOf(mint);
    if (cost > room || placed.length >= spec.maxPlaced) return;
    room -= cost;
    const tile = freeTile(placed, () => false, spec);
    if (tile) placed.push({ mint, ...tile });
  });
  return { v: 1, placed, props: null };
}

/** Keeps a saved layout honest: drops rebyters that are no longer owned, fills free places. */
export function reconcile(layout: WorldLayout, owned: string[]): WorldLayout {
  const have = new Set(owned);
  const placed = layout.placed.filter((p) => have.has(p.mint));
  const seen = new Set<string>();
  const unique = placed.filter((p) => (seen.has(p.mint) ? false : (seen.add(p.mint), true)));
  return { ...layout, placed: unique };
}

/**
 * Keeps the first `allowance(key)` objects of each kind and sets the rest aside. What the wallet holds
 * decides what stands in the habitat; objects it no longer holds are hidden, not deleted.
 */
export function limitProps(props: PlacedProp[], allowance: (key: AssetKey) => number) {
  const used = new Map<AssetKey, number>();
  const shown: PlacedProp[] = [];
  const hidden: PlacedProp[] = [];
  for (const prop of props) {
    const n = used.get(prop.key) ?? 0;
    if (n < allowance(prop.key)) {
      used.set(prop.key, n + 1);
      shown.push(prop);
    } else hidden.push(prop);
  }
  return { shown, hidden };
}

/** Ground tiles the placed rebyters take (each one its footprint: 1 for 1×1, 4 for 2×2). */
export function tilesUsed(placed: PlacedRebyter[], tilesOf: (mint: string) => number) {
  return placed.reduce((n, p) => n + tilesOf(p.mint), 0);
}

/** Whether one more rebyter taking `cost` tiles fits: both the tile room and the head count (checked on chain). */
export function hasRoom(placed: PlacedRebyter[], cost: number, spec: Pick<HabitatSpec, "maxTiles" | "maxPlaced">, tilesOf: (mint: string) => number) {
  return tilesUsed(placed, tilesOf) + cost <= spec.maxTiles && placed.length + 1 <= spec.maxPlaced;
}

/** Drops the oldest placed rebyters until one more taking `cost` tiles fits. */
export function makeRoom(placed: PlacedRebyter[], cost: number, spec: Pick<HabitatSpec, "maxTiles" | "maxPlaced">, tilesOf: (mint: string) => number) {
  const out = [...placed];
  while (out.length && !hasRoom(out, cost, spec, tilesOf)) out.shift();
  return out;
}
