/**
 * How many tiles a rebyter covers on the island: `w` tiles across (its width) by `d` tiles deep (its
 * length, front to back). It is chosen per form by the designer, here in code, never derived from the
 * evolution stage: a Giga can be smaller than a Kylo. The world draws the model to fill that rectangle
 * and the island counts `w × d` tiles of its room. Forms not listed cover one tile.
 */
export type Footprint = { w: number; d: number };

export const ONE_TILE: Footprint = { w: 1, d: 1 };

/** Form key (as in the evolution tree, e.g. "fox", "sky_courser") → [tiles across, tiles deep]. */
export const FORM_TILES: Record<string, [number, number]> = {
  // "sky_courser": [2, 2],
};

const MAX_SIDE = 4;
const side = (v: number) => Math.max(1, Math.min(MAX_SIDE, Math.round(v) || 1));
const keyOf = (form: { key?: string; name?: string }) => (form.key || form.name || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

/** The tiles a form covers (1 × 1 unless it is listed in FORM_TILES). */
export function footprintOf(form: { key?: string; name?: string } | null | undefined): Footprint {
  const entry = form ? FORM_TILES[keyOf(form)] : undefined;
  return entry ? { w: side(entry[0]), d: side(entry[1]) } : ONE_TILE;
}

/** Tiles a footprint covers on the ground, which is also the island room it takes. */
export const tilesOf = (f: Footprint) => f.w * f.d;
