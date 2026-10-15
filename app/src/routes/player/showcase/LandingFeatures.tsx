import { Suspense, lazy, useState } from "react";
import { createPortal } from "react-dom";
import { Gem, Heart, Mountain, Sprout } from "lucide-react";
import type { ShowcasePage } from "./Showcase";

const Showcase = lazy(() => import("./Showcase").then((m) => ({ default: m.Showcase })));

const ITEMS: { id: ShowcasePage; label: string; Icon: typeof Heart }[] = [
  { id: "raise", label: "RAISE", Icon: Heart },
  { id: "evolve", label: "EVOLVE", Icon: Sprout },
  { id: "collect", label: "COLLECT", Icon: Gem },
  { id: "explore", label: "EXPLORE", Icon: Mountain },
];

/** The four feature buttons of the start screen; each opens the tour at its page. */
export function LandingFeatures() {
  const [page, setPage] = useState<ShowcasePage | null>(null);
  return (
    <>
      <div className="landing-features" aria-label="reByters features">
        {ITEMS.map(({ id, label, Icon }) => (
          <button key={id} type="button" className="landing-feature" onClick={() => setPage(id)}>
            <span><Icon /></span>
            <small>{label}</small>
          </button>
        ))}
      </div>
      {page &&
        createPortal(
          <div className="rb-ui">
            <Suspense fallback={null}>
              <Showcase page={page} onPage={setPage} onClose={() => setPage(null)} />
            </Suspense>
          </div>,
          document.body,
        )}
    </>
  );
}
