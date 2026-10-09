import { PublicKey } from "@solana/web3.js";
import type { AssetKey } from "../../components/assets/meadow";
import type { WorldLayout } from "../../components/world/layout";

/**
 * How the habitat layout is stored inside the habitat NFT (see `set_habitat_layout` in the program).
 * The order of PROP_KEYS is part of the format: append only, never reorder.
 */
export const PROP_KEYS: AssetKey[] = ["tree", "pine", "bush", "rocks", "stump", "log", "mushrooms", "wildflowers", "lantern", "vending", "busStop"];
/** Largest layout any habitat can hold: MAX_PLACED_SLOTS and MAX_PROP_SLOTS in the program. */
export const MAX_PLACED_SLOTS = 12;
export const MAX_PROP_SLOTS = 50;

const TURN = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Reads the LAYOUT field of a habitat NFT (hex of the bytes the program writes): set flag, placed
 * count, placed Rebyters (mint 32, i, j), prop count, props (kind, x, z, h, r). A blank habitat is
 * the single byte 0. Returns null while the habitat has never been laid out, or when malformed.
 */
export function layoutFromHex(hex: string | null | undefined): WorldLayout | null {
  if (!hex || hex.length < 2 || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let n = 0; n < bytes.length; n++) bytes[n] = parseInt(hex.slice(n * 2, n * 2 + 2), 16);
  if (bytes[0] !== 1 || bytes.length < 3) return null;
  const view = new DataView(bytes.buffer);
  const placedCount = bytes[1];
  if (placedCount > MAX_PLACED_SLOTS || bytes.length < 2 + placedCount * 34 + 1) return null;
  let at = 2;
  const placed: WorldLayout["placed"] = [];
  for (let n = 0; n < placedCount; n++, at += 34) {
    placed.push({ mint: new PublicKey(bytes.slice(at, at + 32)).toBase58(), i: bytes[at + 32], j: bytes[at + 33] });
  }
  const propCount = bytes[at];
  at += 1;
  if (propCount > MAX_PROP_SLOTS || bytes.length < at + propCount * 9) return null;
  const props: NonNullable<WorldLayout["props"]> = [];
  for (let n = 0; n < propCount; n++, at += 9) {
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

/** The instruction arguments for a layout (objects of unknown kind, or past the limits, are dropped). */
export function encodeLayout(layout: WorldLayout) {
  const seen = new Set<string>();
  const placed = layout.placed
    .filter((p) => (seen.has(p.mint) ? false : (seen.add(p.mint), true)))
    .slice(0, MAX_PLACED_SLOTS)
    .map((p) => ({ mint: new PublicKey(p.mint), i: p.i, j: p.j }));
  const props = (layout.props ?? [])
    .filter((p) => PROP_KEYS.includes(p.key))
    .slice(0, MAX_PROP_SLOTS)
    .map((p) => ({
      kind: PROP_KEYS.indexOf(p.key),
      x: clamp(Math.round(p.x * 1000), -32768, 32767),
      z: clamp(Math.round(p.z * 1000), -32768, 32767),
      h: clamp(Math.round(p.h * 1000), 1, 65535),
      r: Math.round((((p.r % TURN) + TURN) % TURN) / TURN * 65535),
    }));
  return { placed, props };
}
