import { Suspense, lazy, useMemo } from "react";
import { defaultLayout, specFor } from "../../components/world/layout";
import type { WorldCreature } from "../../components/world/PlayerWorld";
import type { WorldPeriod } from "../../hooks/useWorldClock";
import type { Evolution } from "../../lib/rebyters/types";
import { byName } from "./showcase/showcaseData";

const PlayerWorld = lazy(() => import("../../components/world/PlayerWorld").then((m) => ({ default: m.PlayerWorld })));

/**
 * Dev page: a 2D directional sprite (front / side / back frames from /sprite-lab) wandering the real
 * island next to the bundled 3D creatures. No wallet, nothing saved. Query: ?period=Night&only=1&size=7
 */
export function SpriteLab() {
  const query = new URLSearchParams(location.search);
  const period = (query.get("period") ?? "Day") as WorldPeriod;
  const only = query.get("only") === "1";
  const size = Number(query.get("size") ?? 7) as 7;
  const focus = query.get("focus");
  const spec = useMemo(() => specFor(size), [size]);
  const creatures = useMemo<WorldCreature[]>(() => {
    const base = byName("Finbit");
    const sprite: Evolution = {
      ...base,
      id: 99901,
      key: "lab.rocadillo",
      name: "Rocadillo",
      stage: 2,
      modelUri: "",
      assets: {
        thumbnailUri: "/sprite-lab/front.png",
        spriteViews: { front: "/sprite-lab/front.png", side: "/sprite-lab/side.png", back: "/sprite-lab/back.png" },
      },
    };
    const forms = only ? [sprite] : [sprite, { ...sprite, id: 99902 }, byName("Finbit"), byName("Cetacean")];
    return forms.map((evolution, i) => ({
      mint: `lab-${i}-${evolution.id}`,
      evolution,
      emote: null,
      happy: false,
      level: 1,
      stageName: "Kylo",
      fullness: 80,
      energy: 80,
      bond: 60,
    }));
  }, [only]);
  const layout = useMemo(() => defaultLayout(creatures.map((c) => c.mint), spec), [creatures, spec]);
  return (
    <div className="rb-ui" style={{ position: "fixed", inset: 0, background: "#0c1a2e" }}>
      <Suspense fallback={<div className="world-loading">Loading…</div>}>
        <PlayerWorld
          creatures={creatures}
          initialLayout={layout}
          onCommitLayout={async () => undefined}
          period={period}
          onSelect={() => undefined}
          editable={false}
          showcase
          size={size}
          focusMint={focus != null ? creatures[Number(focus)]?.mint : null}
        />
      </Suspense>
    </div>
  );
}
