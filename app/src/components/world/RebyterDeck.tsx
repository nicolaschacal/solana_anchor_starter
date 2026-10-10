import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { CreatureSprite } from "../admin/CreatureSprite";
import type { WorldCreature } from "./PlayerWorld";

const STEP_MS = 4500;
const PAUSE_MS = 9000;

/**
 * A slim card per rebyter on the island. It advances by itself, one rebyter after another,
 * and the player can swipe it (or tap a dot) whenever they like; touching it pauses the tour.
 */
export function RebyterDeck({ creatures, onOpen }: { creatures: WorldCreature[]; onOpen: (mint: string) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const pausedUntil = useRef(0);
  const [index, setIndex] = useState(0);
  const count = creatures.length;

  const goTo = (n: number, smooth = true) => {
    const el = track.current;
    if (!el || !count) return;
    const next = ((n % count) + count) % count;
    el.scrollTo({ left: next * el.clientWidth, behavior: smooth ? "smooth" : "auto" });
  };

  useEffect(() => {
    if (count < 2) return;
    const timer = window.setInterval(() => {
      if (Date.now() < pausedUntil.current || document.hidden) return;
      goTo(index + 1);
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, [index, count]);

  useEffect(() => {
    if (index >= count && count) goTo(0, false);
  }, [count]);

  if (!count) return null;
  const hold = () => {
    pausedUntil.current = Date.now() + PAUSE_MS;
  };
  return (
    <div className="rb-deck gl-panel" role="region" aria-label="Rebyters on this island">
      <div
        className="rb-deck-track"
        ref={track}
        onPointerDown={hold}
        onWheel={hold}
        onTouchStart={hold}
        onScroll={(e) => {
          const el = e.currentTarget;
          const n = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (n !== index) setIndex(Math.min(n, count - 1));
        }}
      >
        {creatures.map((c) => (
          <button key={c.mint} className="rb-deck-card" onClick={() => onOpen(c.mint)} aria-label={`Open ${c.evolution.name}`}>
            <span className="rb-deck-art">
              <CreatureSprite evolution={c.evolution} />
            </span>
            <span className="rb-deck-info">
              <strong>{c.evolution.name}</strong>
              <small>
                Lv {c.level} · {c.stageName}
              </small>
              <span className="rb-deck-meters" aria-hidden="true">
                <i className="food" style={{ ["--v" as string]: `${Math.max(4, c.fullness)}%` }} />
                <i className="energy" style={{ ["--v" as string]: `${Math.max(4, c.energy)}%` }} />
              </span>
            </span>
            <span className="rb-deck-go" aria-hidden="true">
              <ChevronRight />
            </span>
          </button>
        ))}
      </div>
      {count > 1 && (
        <div className="rb-deck-dots">
          {creatures.map((c, n) => (
            <button key={c.mint} className={n === index ? "on" : ""} aria-label={`Show ${c.evolution.name}`} onClick={() => { hold(); goTo(n); }} />
          ))}
        </div>
      )}
    </div>
  );
}
