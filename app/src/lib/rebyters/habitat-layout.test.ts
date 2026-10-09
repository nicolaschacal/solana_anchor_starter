import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { encodeLayout, layoutFromHex, LAYOUT_BYTES, PROP_KEYS } from "./habitat-layout";

const mint = (n: number) => new PublicKey(new Uint8Array(32).fill(n)).toBase58();

/** What the program writes into the LAYOUT field: the same bytes `encode_layout` builds, as hex. */
function toHex(wire: ReturnType<typeof encodeLayout>) {
  const out: number[] = [1];
  for (const p of wire.placed) out.push(...new PublicKey(p.mint).toBytes(), p.i, p.j);
  out.push(wire.propCount);
  const word = (v: number) => [v & 255, (v >> 8) & 255];
  for (const p of wire.props) out.push(p.kind, ...word(p.x & 0xffff), ...word(p.z & 0xffff), ...word(p.h), ...word(p.r));
  return out.map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("habitat layout format", () => {
  it("round-trips rebyters and objects", () => {
    const layout = {
      v: 1 as const,
      placed: [{ mint: mint(1), i: 18, j: 30 }, { mint: mint(2), i: 19, j: 31 }],
      props: [
        { key: "pine" as const, x: -13.25, z: -25.5, h: 1.8, r: 1.0 },
        { key: "lantern" as const, x: -12, z: -24.75, h: 0.9, r: 6.2 },
      ],
    };
    const wire = encodeLayout(layout);
    expect(wire.propCount).toBe(2);
    expect(wire.props).toHaveLength(14);
    expect(wire.placed).toHaveLength(3);
    const hex = toHex(wire);
    expect(hex).toHaveLength(LAYOUT_BYTES * 2);
    const back = layoutFromHex(hex)!;
    expect(back.placed).toEqual(layout.placed);
    back.props!.forEach((p, n) => {
      expect(p.key).toBe(layout.props[n].key);
      expect(p.x).toBeCloseTo(layout.props[n].x, 2);
      expect(p.z).toBeCloseTo(layout.props[n].z, 2);
      expect(p.h).toBeCloseTo(layout.props[n].h, 2);
      expect(p.r).toBeCloseTo(layout.props[n].r, 3);
    });
  });

  it("reads nothing until a layout was saved, or from a malformed field", () => {
    expect(layoutFromHex("0".repeat(LAYOUT_BYTES * 2))).toBeNull();
    expect(layoutFromHex(null)).toBeNull();
    expect(layoutFromHex("abcd")).toBeNull();
    expect(layoutFromHex("zz".repeat(LAYOUT_BYTES))).toBeNull();
    expect(layoutFromHex(toHex(encodeLayout({ v: 1, placed: [], props: [] })))).toEqual({ v: 1, placed: [], props: [] });
  });

  it("keeps at most 14 objects and ignores kinds it does not know", () => {
    const props = Array.from({ length: 20 }, (_, n) => ({ key: PROP_KEYS[n % PROP_KEYS.length], x: -14, z: -26, h: 1, r: 0 }));
    expect(encodeLayout({ v: 1, placed: [], props }).propCount).toBe(14);
    expect(encodeLayout({ v: 1, placed: [], props: [{ key: "nope" as never, x: 0, z: 0, h: 1, r: 0 }] }).propCount).toBe(0);
  });

  it("matches the program's object kind count and layout size", () => {
    expect(PROP_KEYS).toHaveLength(11);
    expect(LAYOUT_BYTES).toBe(230);
  });
});
