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

/**
 * What an island holds. Its size fixes a ceiling (3, 5 or 8 rebyters; 14, 24 or 40 objects) and its land
 * can lower it: water and cliffs are not standable, and every rebyter needs about 8 free tiles and every
 * object about 2.
 */
export type HabitatSpec = {
  size: HabitatSize;
  climate: Climate;
  board: { i0: number; i1: number; j0: number; j1: number };
  /** Tiles of the island that can be stood on. */
  freeTiles: number;
  maxPlaced: number;
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
  const { freeTiles, maxPlaced, maxProps } = islandCapacity(size, climate);
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

/** The first free starting tile for a new arrival. */
export function freeTile(taken: { i: number; j: number }[], blocked: (i: number, j: number) => boolean, spec: HabitatSpec = DEFAULT_SPEC) {
  const used = new Set(taken.map((t) => `${t.i},${t.j}`));
  const candidates: [number, number][] = [...spec.start];
  for (let i = spec.board.i0; i <= spec.board.i1; i++) for (let j = spec.board.j0; j <= spec.board.j1; j++) candidates.push([i, j]);
  const found = candidates.find(([i, j]) => !used.has(`${i},${j}`) && spec.free(i, j) && !blocked(i, j));
  return found ? { i: found[0], j: found[1] } : null;
}

/** The layout to start from: the first rebyters on the first free tiles. */
export function defaultLayout(mints: string[], spec: HabitatSpec = DEFAULT_SPEC): WorldLayout {
  const placed: PlacedRebyter[] = [];
  mints.slice(0, spec.maxPlaced).forEach((mint) => {
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
