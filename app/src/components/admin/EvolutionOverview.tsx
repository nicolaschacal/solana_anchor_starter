import { ArrowRight, GitMerge } from "lucide-react";
import type { TreeJson } from "../../lib/rebyters/types";
import { GRAPH_STAGE_ORDER } from "../../lib/rebyters/graph";
import { CreatureSprite } from "./CreatureSprite";

const COLORS = [
  "#57706f",
  "#17988b",
  "#3585b3",
  "#d28729",
  "#d35f72",
  "#8862b3",
];
const LABELS = [
  "Origin",
  "Early branches",
  "Body plans",
  "Mature forms",
  "Specializations",
  "Ascensions",
];
export function EvolutionOverview({
  tree,
  search,
  stage,
  onStageChange,
  onSelect,
}: {
  tree: TreeJson;
  search: string;
  stage: number | "all";
  onStageChange: (stage: number | "all") => void;
  onSelect: (id: number) => void;
}) {
  const query = search.trim().toLowerCase();
  const counts = GRAPH_STAGE_ORDER.map(
    (_, i) => tree.evolutions.filter((e) => e.stage === i).length,
  );
  const matching = tree.evolutions.filter((e) =>
    e.name.toLowerCase().includes(query),
  );
  return (
    <div className="collection-overview">
      <div
        className="collection-stage-tabs"
        role="group"
        aria-label="Filter by stage"
      >
        <button
          aria-pressed={stage === "all" && !query}
          onClick={() => onStageChange("all")}
        >
          All <span>{tree.evolutions.length}</span>
        </button>
        {GRAPH_STAGE_ORDER.map((label, i) => (
          <button
            key={label}
            aria-pressed={stage === i && !query}
            onClick={() => onStageChange(i)}
            style={{ "--stage-color": COLORS[i] } as React.CSSProperties}
          >
            <i />
            {label}
            <span>{counts[i]}</span>
          </button>
        ))}
      </div>
      <div
        className={`collection-groups ${stage === "all" && !query ? "is-all" : ""}`}
        aria-label="Specimens by stage"
      >
        {GRAPH_STAGE_ORDER.map((label, i) => {
          if (!query && stage !== "all" && stage !== i) return null;
          const forms = matching.filter((e) => e.stage === i);
          if (query && !forms.length) return null;
          return (
            <section
              key={label}
              data-stage={i}
              className="collection-stage"
              aria-label={`${label} specimens`}
              style={{ "--stage-color": COLORS[i] } as React.CSSProperties}
            >
              <header>
                <span className="collection-stage-number">0{i + 1}</span>
                <h3>
                  {label}
                  <span>{forms.length}</span>
                </h3>
                <p>{LABELS[i]}</p>
              </header>
              <div className="collection-specimens">
                {forms.map((e) => {
                  const incoming = tree.evolutions.filter((source) =>
                    source.paths.some((p) => p.target === e.id),
                  ).length;
                  return (
                    <button
                      className="specimen-tile"
                      key={e.id}
                      aria-label={`${e.name}, ${label}`}
                      onClick={() => onSelect(e.id)}
                    >
                      <CreatureSprite evolution={e} />
                      <span className="specimen-tile-text">
                        <strong>{e.name}</strong>
                        <small>
                          {e.stage === 0 ? "Universal origin" : e.family}
                        </small>
                      </span>
                      <span
                        className="specimen-tile-routes"
                        title={`${incoming} previous forms, ${e.paths.length} next forms`}
                      >
                        <GitMerge size={10} />
                        {incoming}
                        <ArrowRight size={10} />
                        {e.paths.length}
                      </span>
                    </button>
                  );
                })}
                {!forms.length && (
                  <p className="collection-empty">
                    No specimens in this stage.
                  </p>
                )}
              </div>
            </section>
          );
        })}
        {!matching.length && (
          <p className="collection-empty">No matching specimens.</p>
        )}
      </div>
      <div className="collection-total">
        <span>{tree.evolutions.length} SPECIMENS</span>
        <span>
          {tree.evolutions.reduce((n, e) => n + e.paths.length, 0)} EVOLUTION
          PATHS
        </span>
        <span>
          ORIGIN /{" "}
          {tree.evolutions.find((e) => e.stage === 0)?.name ?? "Unassigned"}
        </span>
      </div>
    </div>
  );
}
