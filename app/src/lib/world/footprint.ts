/**
 * How many tiles a rebyter covers on the island: `w` tiles across (its width) by `d` tiles deep (its
 * length, front to back). The world draws the model to fill that rectangle and the island counts `w × d`
 * tiles of its room, so it is also what limits how many big rebyters an island takes.
 *
 * Current rule: up to Kylo (stage 2) a rebyter covers 1×1; from Mega (stage 3) up it covers 2×2 (4 tiles),
 * so the 5×5 island (6 tiles) holds one Mega at most and a second one needs the island expander.
 * A form listed in FORM_TILES overrides the rule (e.g. a small Giga).
 */
export type Footprint = { w: number; d: number };

export const ONE_TILE: Footprint = { w: 1, d: 1 };

/** First stage that covers 2×2: Mega. */
export const BIG_STAGE = 3;
export const BIG: Footprint = { w: 2, d: 2 };

/** Per-form exceptions to the stage rule. Form key (as in the evolution tree, e.g. "fox") → [across, deep]. */
export const FORM_TILES: Record<string, [number, number]> = {
  // "kitsune": [1, 1],
};

const MAX_SIDE = 4;
const side = (v: number) => Math.max(1, Math.min(MAX_SIDE, Math.round(v) || 1));
const keyOf = (form: { key?: string; name?: string }) => (form.key || form.name || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

/** The tiles a form covers: its FORM_TILES entry, else 1×1 up to Kylo and 2×2 from Mega. */
export function footprintOf(form: { key?: string; name?: string; stage?: number } | null | undefined): Footprint {
  const entry = form ? FORM_TILES[keyOf(form)] : undefined;
  if (entry) return { w: side(entry[0]), d: side(entry[1]) };
  return (form?.stage ?? 0) >= BIG_STAGE ? BIG : ONE_TILE;
}

/** Tiles a footprint covers on the ground, which is also the island room it takes. */
export const tilesOf = (f: Footprint) => f.w * f.d;
