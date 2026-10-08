import { OX, OZ } from "../admin/habitat/tiles";
import { HabitatWorld } from "../admin/habitat/world";
import type { AssetKey } from "../assets/meadow";

/** How many rebyters stand in the world at once, and how many objects it can hold. */
export const MAX_PLACED = 3;
export const MAX_PROPS = 14;

export type PlacedRebyter = { mint: string; i: number; j: number };
export type PlacedProp = { key: AssetKey; x: number; z: number; h: number; r: number };
export type WorldLayout = { v: 1; placed: PlacedRebyter[]; props: PlacedProp[] | null };

const region = HabitatWorld.regionFor(5);
/** The board is 5x5 tiles. */
export const BOARD = { i0: region.i0, i1: region.i1, j0: region.j0, j1: region.j1 };
export const tileX = (i: number) => OX + i;
export const tileZ = (j: number) => OZ + j;
export const onBoard = (i: number, j: number) => i >= BOARD.i0 && i <= BOARD.i1 && j >= BOARD.j0 && j <= BOARD.j1;

/** Where the first rebyters start: spread out, away from the tree in the corner. */
const START: [number, number][] = [
  [BOARD.i0 + 2, BOARD.j0 + 2],
  [BOARD.i1 - 1, BOARD.j1 - 1],
  [BOARD.i0 + 1, BOARD.j1 - 1],
  [BOARD.i1 - 1, BOARD.j0 + 2],
];
/** The tile the default tree stands on. */
export const TREE_TILE = { i: BOARD.i0, j: BOARD.j0 };

/** The first free starting tile for a new arrival. */
export function freeTile(taken: { i: number; j: number }[], blocked: (i: number, j: number) => boolean) {
  const used = new Set(taken.map((t) => `${t.i},${t.j}`));
  const candidates: [number, number][] = [...START];
  for (let i = BOARD.i0; i <= BOARD.i1; i++) for (let j = BOARD.j0; j <= BOARD.j1; j++) candidates.push([i, j]);
  const found = candidates.find(([i, j]) => !used.has(`${i},${j}`) && !blocked(i, j));
  return found ? { i: found[0], j: found[1] } : null;
}

/** The layout to start from: the first rebyters on the first free tiles. */
export function defaultLayout(mints: string[]): WorldLayout {
  const placed: PlacedRebyter[] = [];
  mints.slice(0, MAX_PLACED).forEach((mint, index) => {
    const [i, j] = START[index];
    placed.push({ mint, i, j });
  });
  return { v: 1, placed, props: null };
}

export function loadLayout(key: string): WorldLayout | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as WorldLayout;
    if (data?.v !== 1 || !Array.isArray(data.placed)) return null;
    const placed = data.placed.filter(
      (p) => typeof p?.mint === "string" && Number.isInteger(p.i) && Number.isInteger(p.j) && onBoard(p.i, p.j),
    );
    const props = Array.isArray(data.props)
      ? data.props.filter((p) => typeof p?.key === "string" && [p.x, p.z, p.h, p.r].every(Number.isFinite) && p.h > 0)
      : null;
    return { v: 1, placed: placed.slice(0, MAX_PLACED), props };
  } catch {
    return null;
  }
}

export function saveLayout(key: string, layout: WorldLayout) {
  try {
    localStorage.setItem(key, JSON.stringify(layout));
  } catch {
    /* Without storage the layout lasts for this visit. */
  }
}

/** Keeps a saved layout honest: drops rebyters that are no longer owned, fills free places. */
export function reconcile(layout: WorldLayout, owned: string[]): WorldLayout {
  const have = new Set(owned);
  const placed = layout.placed.filter((p) => have.has(p.mint));
  const seen = new Set<string>();
  const unique = placed.filter((p) => (seen.has(p.mint) ? false : (seen.add(p.mint), true)));
  return { ...layout, placed: unique };
}
