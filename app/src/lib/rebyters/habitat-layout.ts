import { PublicKey } from "@solana/web3.js";
import type { AssetKey } from "../../components/assets/meadow";
import type { WorldLayout } from "../../components/world/layout";

/**
 * How the habitat layout is stored inside the habitat NFT (see `set_habitat_layout` in the program).
 * The order of PROP_KEYS is part of the format: append only, never reorder.
 */
export const PROP_KEYS: AssetKey[] = ["tree", "pine", "bush", "rocks", "stump", "log", "mushrooms", "wildflowers", "lantern", "vending", "busStop"];
export const MAX_PLACED_SLOTS = 3;
export const MAX_PROP_SLOTS = 14;

const TURN = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const EMPTY = PublicKey.default;

/** Size in bytes of the layout stored in a habitat NFT: HABITAT_LAYOUT_BYTES in the program. */
export const LAYOUT_BYTES = 1 + MAX_PLACED_SLOTS * 34 + 1 + MAX_PROP_SLOTS * 9;

/**
 * Reads the LAYOUT field of a habitat NFT (hex of the fixed-size bytes the program writes).
 * Returns null while the habitat has never been laid out, or when the field is malformed.
 */
export function layoutFromHex(hex: string | null | undefined): WorldLayout | null {
  if (!hex || hex.length !== LAYOUT_BYTES * 2 || /[^0-9a-f]/i.test(hex)) return null;
  const bytes = new Uint8Array(LAYOUT_BYTES);
  for (let n = 0; n < LAYOUT_BYTES; n++) bytes[n] = parseInt(hex.slice(n * 2, n * 2 + 2), 16);
  if (bytes[0] !== 1) return null;
  const view = new DataView(bytes.buffer);
  let at = 1;
  const placed: WorldLayout["placed"] = [];
  for (let n = 0; n < MAX_PLACED_SLOTS; n++) {
    const mint = new PublicKey(bytes.slice(at, at + 32));
    if (!mint.equals(EMPTY)) placed.push({ mint: mint.toBase58(), i: bytes[at + 32], j: bytes[at + 33] });
    at += 34;
  }
  const propCount = Math.min(bytes[at], MAX_PROP_SLOTS);
  at += 1;
  const props: NonNullable<WorldLayout["props"]> = [];
  for (let n = 0; n < MAX_PROP_SLOTS; n++, at += 9) {
    if (n >= propCount) continue;
    const kind = bytes[at];
    const h = view.getUint16(at + 5, true);
    if (kind >= PROP_KEYS.length || h === 0) continue;
    props.push({
      key: PROP_KEYS[kind],
      x: view.getInt16(at + 1, true) / 1000,
      z: view.getInt16(at + 3, true) / 1000,
      h: h / 1000,
      r: (view.getUint16(at + 7, true) / 65535) * TURN,
    });
  }
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
