import { useMemo } from "react";
import type { Evolution } from "../../lib/rebyters/types";
import { modelUriFor } from "../../lib/assets/catalog";
import { facingInward, spanCenter } from "../admin/habitat/world";
import { OX, OZ } from "../admin/habitat/tiles";
import { PlayerWorld, type WorldCreature } from "./PlayerWorld";
import { specFor, type WorldLayout } from "./layout";

const SIZE = 7;

/**
 * The sign-in screen's postcard: the real island with a bus stop, a vending machine and one 3D reByter.
 * Read-only: nothing to open, edit or save.
 */
export function LandingWorld({ evolutions, worldTime }: { evolutions: Evolution[]; worldTime: number }) {
  const { creatures, layout } = useMemo(() => {
    const form = evolutions.find((e) => e.enabled && modelUriFor(e)) ?? evolutions.find((e) => e.enabled) ?? evolutions[0];
    const spec = specFor(SIZE, "temperate");
    const { i0, i1, j0 } = spec.board;
    const cx = OX + (i0 + i1) / 2;
    const cz = OZ + j0 + 3;
    const busTile = { i: i0 + 1, j: j0 + 1 };
    const vendTile = { i: i1 - 1, j: j0 + 1 };
    const quarter = (x: number, z: number) => facingInward(x, z, cx, cz);
    const vend = { x: OX + vendTile.i, z: OZ + vendTile.j };
    // Both stand with their backs to the sea and face the camera.
    const busR = quarter(vend.x, vend.z);
    const bus = spanCenter("busStop", busTile.i, busTile.j, busR);
    const next: WorldLayout = {
      v: 1,
      placed: [{ mint: "showcase", i: i0 + 3, j: j0 + 4 }],
      props: [
        { key: "busStop", x: bus.x, z: bus.z, h: 5, r: busR },
        { key: "vending", x: vend.x, z: vend.z, h: 4.6, r: quarter(vend.x, vend.z) },
      ],
    };
    const hero: WorldCreature[] = form
      ? [{ mint: "showcase", evolution: form, emote: null, happy: true, level: form.stage + 1, stageName: "", fullness: 80, energy: 80, bond: 60 }]
      : [];
    return { creatures: hero, layout: next };
  }, [evolutions]);
  return (
    <PlayerWorld
      showcase
      creatures={creatures}
      initialLayout={layout}
      onCommitLayout={() => Promise.resolve()}
      period="Day"
      worldTime={worldTime}
      onSelect={() => undefined}
      size={SIZE}
      climate="temperate"
    />
  );
}
