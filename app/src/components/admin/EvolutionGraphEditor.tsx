import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Focus,
  GitBranch,
  LayoutGrid,
  Network,
  Maximize2,
  Minus,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  Background,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  GRAPH_STAGE_ORDER,
  immediateEvolutionNeighborhood,
} from "../../lib/rebyters/graph";
import type { Evolution, TreeJson } from "../../lib/rebyters/types";
import { CreatureSprite } from "./CreatureSprite";
import { EvolutionOverview } from "./EvolutionOverview";

const COLORS = [
  "#57706f",
  "#17988b",
  "#3585b3",
  "#d28729",
  "#d35f72",
  "#8862b3",
];
type CreatureNode = Node<
  {
    evolution: Evolution;
    active: boolean;
    compact: boolean;
    select: (id: number) => void;
  },
  "creature"
>;
function SpecimenNode({ data }: NodeProps<CreatureNode>) {
  const e = data.evolution;
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <button
        className={`creature-node ${data.compact ? "is-compact" : ""} ${data.active ? "is-selected" : ""}`}
        aria-pressed={data.active}
        aria-label={`${e.name}, ${GRAPH_STAGE_ORDER[e.stage]}`}
        onClick={() => data.select(e.id)}
        style={{ "--stage-color": COLORS[e.stage] } as React.CSSProperties}
      >
        <CreatureSprite evolution={e} />
        <span>
          <small>{e.stage === 0 ? "ORIGIN / BIT" : e.family}</small>
          <strong>{e.name}</strong>
          <span className="specimen-code">
            {e.paths.length ? `${e.paths.length} routes` : "Final form"}
          </span>
        </span>
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}
type StageNode = Node<{ label: string; count: number; stage: number }, "stage">;
function StageHeading({ data }: NodeProps<StageNode>) {
  return (
    <div className="stage-label" style={{ color: COLORS[data.stage] }}>
      <span>0{data.stage + 1}</span>
      <strong>{data.label}</strong>
      <small>{data.count} forms</small>
    </div>
  );
}
const nodeTypes = { creature: SpecimenNode, stage: StageHeading };
interface Props {
  tree: TreeJson;
  selectedId?: number | null;
  onSelectEvolution: (id: number) => void;
  onClearSelection: () => void;
}
export function EvolutionGraphEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <Atlas {...props} />
    </ReactFlowProvider>
  );
}
function Atlas({
  tree,
  selectedId,
  onSelectEvolution,
  onClearSelection,
}: Props) {
  const [search, setSearch] = useState("");
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState<"grid" | "map">("grid");
  const [lineageView, setLineageView] = useState<"grid" | "map">("grid");
  const [stageFilter, setStageFilter] = useState<number | "all">(() =>
    window.matchMedia("(max-width: 600px)").matches ? 0 : "all",
  );
  const flow = useReactFlow();
  const selected = tree.evolutions.find((e) => e.id === selectedId);
  const visible = useMemo(
    () =>
      selected
        ? immediateEvolutionNeighborhood(tree, selected.id)
        : tree.evolutions,
    [tree, selected],
  );
  const { nodes, edges } = useMemo(() => {
    const stages = GRAPH_STAGE_ORDER.map((label, stage) => ({
      label,
      stage,
      forms: visible.filter((e) => e.stage === stage),
    })).filter((s) => !selected || s.forms.length);
    const cardHeight = selected ? 74 : 46;
    const gap = selected ? 18 : 8;
    const stageHeight = (forms: Evolution[]) =>
      forms.length * (cardHeight + gap) - gap;
    const columnWidth = selected ? 360 : 270;
    const height = Math.max(...stages.map((s) => stageHeight(s.forms)));
    const nodes: (CreatureNode | StageNode)[] = stages.flatMap((s, column) => [
      {
        id: `stage-${s.stage}`,
        type: "stage",
        position: { x: column * columnWidth, y: -75 },
        data: { label: s.label, count: s.forms.length, stage: s.stage },
        selectable: false,
        draggable: false,
      },
      ...s.forms.map((e, row): CreatureNode => ({
        id: String(e.id),
        type: "creature",
        position: {
          x: column * columnWidth,
          y:
            (height - stageHeight(s.forms)) / 2 +
            row * (cardHeight + gap),
        },
        data: {
          evolution: e,
          active: e.id === selectedId,
          compact: !selected,
          select: onSelectEvolution,
        },
        width: selected ? 300 : 210,
        height: cardHeight,
        style: selected ? { width: 300, height: cardHeight } : undefined,
        draggable: false,
      })),
    ]);
    const ids = new Set(visible.map((e) => e.id));
    const edges = visible.flatMap((e) =>
      e.paths
        .filter(
          (p) =>
            ids.has(p.target) &&
            (!selected || e.id === selected.id || p.target === selected.id),
        )
        .map((p) => {
          const color = selected
            ? p.target === selected.id
              ? "#148f87"
              : "#e27051"
            : COLORS[e.stage];
          return {
            id: `${e.id}-${p.target}`,
            source: String(e.id),
            target: String(p.target),
            type: "default",
            style: {
              stroke: color,
              strokeWidth: selected ? 2.5 : 1.4,
              opacity: selected ? 1 : 0.48,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color,
              width: 14,
              height: 14,
            },
          };
        }),
    );
    return { nodes, edges };
  }, [visible, selected, selectedId, onSelectEvolution, tree.balance]);
  useEffect(() => {
    if (!ready || (!selected && view === "grid") || (selected && lineageView === "grid")) return;
    const frame = requestAnimationFrame(() => {
      if (window.innerWidth <= 800) {
        const focus = nodes.find(
          (n) =>
            n.type === "creature" &&
            (selected
              ? n.id === String(selected.id)
              : (n.data as CreatureNode["data"]).evolution.stage === 0),
        );
        if (focus) {
          void flow.setCenter(
            focus.position.x + (selected ? 150 : 105),
            focus.position.y + (focus.height ?? 74) / 2,
            { zoom: 0.85, duration: 300 },
          );
          return;
        }
      }
      void flow.fitView({
        padding: 0.14,
        maxZoom: selected ? 1.15 : 0.8,
        duration: 300,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, selectedId, tree.evolutions.length, flow, selected, nodes, view, lineageView]);
  const previous = selected
    ? tree.evolutions.filter((e) =>
        e.paths.some((p) => p.target === selected.id),
      )
    : [];
  const next = selected
    ? tree.evolutions.filter((e) =>
        selected.paths.some((p) => p.target === e.id),
      )
    : [];
  const matches = tree.evolutions.filter((e) =>
    e.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  function reset() {
    setSearch("");
    if (!selected) setStageFilter("all");
    onClearSelection();
    if (!selected && view === "map")
      void flow.fitView({ padding: 0.12, maxZoom: 0.8, duration: 300 });
  }
  return (
    <section className="evolution-lab" aria-label="Evolution chart">
      <div className="lab-toolbar">
        <div className="atlas-heading">
          <span className="lab-cross">+</span>
          <div>
            <span className="eyebrow">
              {selected ? "DIRECT LINEAGE" : "MAMMAL CHART / V2"}
            </span>
            <h2>{selected ? selected.name : "Evolution collection"}</h2>
          </div>
        </div>
        <div className="atlas-actions">
          <div
            className="atlas-view-switch"
            role="group"
            aria-label={selected ? "Lineage view" : "Collection view"}
          >
            <button
              aria-pressed={selected ? lineageView === "grid" : view === "grid"}
              title={selected ? "Grouped lineage" : "Grouped collection"}
              aria-label={selected ? "Grouped lineage" : "Grouped collection"}
              onClick={() => selected ? setLineageView("grid") : setView("grid")}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              aria-pressed={selected ? lineageView === "map" : view === "map"}
              title={selected ? "Lineage map" : "Connection map"}
              aria-label={selected ? "Lineage map" : "Connection map"}
              onClick={() => {
                if (selected) {
                  if (lineageView === "map") return;
                  setReady(false);
                  setLineageView("map");
                } else {
                  if (view === "map") return;
                  setReady(false);
                  setView("map");
                }
              }}
            >
              <Network size={16} />
            </button>
          </div>
          <div className="atlas-search">
            <Search size={16} />
            <input
              aria-label="Find a creature"
              placeholder="Find specimen"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="icon"
                title="Clear search"
                aria-label="Clear search"
                onClick={() => setSearch("")}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            className={selected ? "" : "active"}
            title="Show the complete tree"
            onClick={reset}
          >
            <GitBranch size={16} />
            {selected ? "Back to collection" : "All forms"}
          </button>
        </div>
      </div>
      {search.trim() && (selected || view === "map") && (
        <div className="atlas-results" aria-label="Search results">
          {matches.length ? (
            matches.map((e) => (
              <button
                key={e.id}
                onClick={() => {
                  onSelectEvolution(e.id);
                  setSearch("");
                }}
              >
                <CreatureSprite evolution={e} />
                <span>
                  {e.name}
                  <small>{GRAPH_STAGE_ORDER[e.stage]}</small>
                </span>
                <ArrowRight size={14} />
              </button>
            ))
          ) : (
            <p>No matching specimens.</p>
          )}
        </div>
      )}
      {selected && lineageView === "grid" ? (
        <EvolutionOverview
          tree={{ ...tree, evolutions: visible }}
          search={search}
          stage="all"
          onStageChange={() => undefined}
          onSelect={onSelectEvolution}
          compact
          selectedId={selected.id}
        />
      ) : !selected && view === "grid" ? (
        <EvolutionOverview
          tree={tree}
          search={search}
          stage={stageFilter}
          onStageChange={(stage) => {
            setSearch("");
            setStageFilter(stage);
          }}
          onSelect={onSelectEvolution}
        />
      ) : (
        <>
          <div className={`atlas-canvas ${selected ? "is-focused" : ""}`}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              minZoom={0.15}
              maxZoom={1.8}
              onInit={() => setReady(true)}
              onMove={(_, viewport) => setZoom(viewport.zoom)}
              fitView
              fitViewOptions={{ padding: 0.14 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#c5cdcb" gap={22} size={1} />
              <MiniMap
                pannable
                zoomable
                nodeColor={(node) =>
                  node.type === "stage"
                    ? "transparent"
                    : COLORS[(node.data.evolution as Evolution).stage]
                }
                maskColor="rgba(238,242,239,.7)"
                ariaLabel="Evolution atlas minimap"
              />
            </ReactFlow>
            <div className="atlas-viewport-tools">
              <button
                className="icon"
                title="Zoom in"
                aria-label="Zoom in"
                onClick={() => void flow.zoomIn({ duration: 180 })}
              >
                <Plus size={17} />
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                className="icon"
                title="Zoom out"
                aria-label="Zoom out"
                onClick={() => void flow.zoomOut({ duration: 180 })}
              >
                <Minus size={17} />
              </button>
              <button
                className="icon"
                title="Fit visible tree"
                aria-label="Fit visible tree"
                onClick={() =>
                  void flow.fitView({
                    padding: 0.14,
                    maxZoom: 1.15,
                    duration: 300,
                  })
                }
              >
                <Maximize2 size={16} />
              </button>
              <button
                className="icon"
                title="Center origin"
                aria-label="Center origin"
                onClick={() => {
                  const origin = nodes.find(
                    (n) =>
                      n.type === "creature" &&
                      (n.data as CreatureNode["data"]).evolution.stage === 0,
                  );
                  if (origin)
                    void flow.setCenter(
                      origin.position.x + 105,
                      origin.position.y + 36,
                      { zoom: 1, duration: 300 },
                    );
                  else {
                    const root = tree.evolutions.find((e) => e.stage === 0);
                    if (root) onSelectEvolution(root.id);
                  }
                }}
              >
                <Focus size={16} />
              </button>
            </div>
            <div className="atlas-coordinate">
              {selected ? "LINEAGE SCAN" : "MAMMAL ECOSYSTEM"}
              <span>
                {String(visible.length).padStart(2, "0")} SPECIMENS /{" "}
                {edges.length} LINKS
              </span>
            </div>
          </div>
          <div className="atlas-caption">
            <div>
              {GRAPH_STAGE_ORDER.map((s, i) => (
                <span key={s}>
                  <i style={{ background: COLORS[i] }} />
                  {s}
                </span>
              ))}
            </div>
            <span>
              {selected ? "DIRECT CONNECTIONS" : "ONE ORIGIN / SIX STAGES"}
            </span>
          </div>
        </>
      )}
      {selected && (
        <div className="specimen-panel">
          <div className="specimen-identity">
            <CreatureSprite evolution={selected} />
            <div>
              <span className="eyebrow">
                {GRAPH_STAGE_ORDER[selected.stage]} / {selected.rarity}
              </span>
              <h3>{selected.name}</h3>
              <p>{selected.description}</p>
              <small>{selected.visualDescription}</small>
            </div>
          </div>
          <div className="specimen-relations">
            <div>
              <h4>
                <ArrowLeft size={14} />
                Previous forms <span>{previous.length}</span>
              </h4>
              {previous.length ? (
                previous.map((e) => (
                  <button key={e.id} onClick={() => onSelectEvolution(e.id)}>
                    <CreatureSprite evolution={e} />
                    {e.name}
                  </button>
                ))
              ) : (
                <p>Universal origin</p>
              )}
            </div>
            <div>
              <h4>
                Next forms <span>{next.length}</span>
                <ArrowRight size={14} />
              </h4>
              {next.length ? (
                next.map((e) => (
                  <button key={e.id} onClick={() => onSelectEvolution(e.id)}>
                    <CreatureSprite evolution={e} />
                    {e.name}
                  </button>
                ))
              ) : (
                <p>Final form</p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
