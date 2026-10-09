import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { decodeLayout, encodeLayout, PROP_KEYS } from "./habitat-layout";

const mint = (n: number) => new PublicKey(new Uint8Array(32).fill(n)).toBase58();

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
    const back = decodeLayout({ layoutSet: true, placed: wire.placed, propCount: wire.propCount, props: wire.props })!;
    expect(back.placed).toEqual(layout.placed);
    back.props!.forEach((p, n) => {
      expect(p.key).toBe(layout.props[n].key);
      expect(p.x).toBeCloseTo(layout.props[n].x, 2);
      expect(p.z).toBeCloseTo(layout.props[n].z, 2);
      expect(p.h).toBeCloseTo(layout.props[n].h, 2);
      expect(p.r).toBeCloseTo(layout.props[n].r, 3);
    });
  });

  it("reads nothing until a layout was saved", () => {
    const wire = encodeLayout({ v: 1, placed: [], props: [] });
    expect(decodeLayout({ layoutSet: false, ...wire, propCount: 0 })).toBeNull();
    expect(decodeLayout(null)).toBeNull();
    expect(decodeLayout({ layoutSet: true, ...wire, propCount: 0 })).toEqual({ v: 1, placed: [], props: [] });
  });

  it("keeps at most 14 objects and ignores kinds it does not know", () => {
    const props = Array.from({ length: 20 }, (_, n) => ({ key: PROP_KEYS[n % PROP_KEYS.length], x: -14, z: -26, h: 1, r: 0 }));
    expect(encodeLayout({ v: 1, placed: [], props }).propCount).toBe(14);
    expect(encodeLayout({ v: 1, placed: [], props: [{ key: "nope" as never, x: 0, z: 0, h: 1, r: 0 }] }).propCount).toBe(0);
  });

  it("matches the program's object kind count", () => {
    expect(PROP_KEYS).toHaveLength(11);
  });
});
