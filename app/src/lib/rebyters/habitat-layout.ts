import { PublicKey } from "@solana/web3.js";
import type { AssetKey } from "../../components/assets/meadow";
import type { WorldLayout } from "../../components/world/layout";

/**
 * How the habitat layout is stored in the PlayerProfile account (see `set_layout` in the program).
 * The order of PROP_KEYS is part of the format: append only, never reorder.
 */
export const PROP_KEYS: AssetKey[] = ["tree", "pine", "bush", "rocks", "stump", "log", "mushrooms", "wildflowers", "lantern", "vending", "busStop"];
export const MAX_PLACED_SLOTS = 3;
export const MAX_PROP_SLOTS = 14;

const TURN = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export type ChainLayout = {
  layoutSet: boolean;
  placed: { mint: PublicKey; i: number; j: number }[];
  propCount: number;
  props: { kind: number; x: number; z: number; h: number; r: number }[];
};

const EMPTY = PublicKey.default;

/** The layout stored in the profile, or null when the player never saved one. */
export function decodeLayout(chain: ChainLayout | null | undefined): WorldLayout | null {
  if (!chain?.layoutSet) return null;
  const placed = chain.placed.filter((p) => !p.mint.equals(EMPTY)).map((p) => ({ mint: p.mint.toBase58(), i: p.i, j: p.j }));
  const props = chain.props
    .slice(0, chain.propCount)
    .filter((p) => p.kind < PROP_KEYS.length && p.h > 0)
    .map((p) => ({ key: PROP_KEYS[p.kind], x: p.x / 1000, z: p.z / 1000, h: p.h / 1000, r: (p.r / 65535) * TURN }));
  return { v: 1, placed, props };
}

/** The instruction arguments for a layout (extra rebyters, objects of unknown kind or past 14 are dropped). */
export function encodeLayout(layout: WorldLayout) {
  const placed = Array.from({ length: MAX_PLACED_SLOTS }, (_, n) => {
    const p = layout.placed[n];
    return p ? { mint: new PublicKey(p.mint), i: p.i, j: p.j } : { mint: EMPTY, i: 0, j: 0 };
  });
  const entries = (layout.props ?? [])
    .filter((p) => PROP_KEYS.includes(p.key))
    .slice(0, MAX_PROP_SLOTS)
    .map((p) => ({
      kind: PROP_KEYS.indexOf(p.key),
      x: clamp(Math.round(p.x * 1000), -32768, 32767),
      z: clamp(Math.round(p.z * 1000), -32768, 32767),
      h: clamp(Math.round(p.h * 1000), 1, 65535),
      r: Math.round((((p.r % TURN) + TURN) % TURN) / TURN * 65535),
    }));
  const props = Array.from({ length: MAX_PROP_SLOTS }, (_, n) => entries[n] ?? { kind: 0, x: 0, z: 0, h: 0, r: 0 });
  return { placed, props, propCount: entries.length };
}
