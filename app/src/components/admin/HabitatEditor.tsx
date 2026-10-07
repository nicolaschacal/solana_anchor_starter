import {
  Download,
  Droplets,
  Eraser,
  Grid3X3,
  Hand,
  Layers,
  Mountain,
  MousePointer2,
  Paintbrush,
  PawPrint,
  Redo2,
  Trees,
  Undo2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PERIODS, type WorldPeriod } from "../../hooks/useWorldClock";
import { useEvolutionTree } from "../../hooks/useEvolutionTree";
import { inspectModel, loader } from "../../lib/assets/rig";
import type { Registry } from "../../lib/rebyters/types";
import type { AssetKey } from "../assets/meadow";
import "./habitat/HabitatEditor.css";
import {
  DEFAULT_LIGHTING,
  HabitatWorld,
  type Lighting,
  PROP_CATALOG,
  type Pane,
  type PropEntry,
  type SceneData,
  type ViewId,
  type ViewMode,
} from "./habitat/world";
import type { Ground } from "./habitat/tiles";

type Tool = "ground" | "water" | "relief" | "object" | "select" | "creature" | "erase" | "nav";
type Sub = "path" | "sand" | "rock" | "grass" | "add" | "remove" | "up" | "down";

const STORAGE = "habitat-editor-scene-v1";
const PERIOD_LABEL: Record<WorldPeriod, string> = {
  Night: "Noche",
  Morning: "Mañana",
  Day: "Día",
  Evening: "Atardecer",
};
const VIEW_LABEL: Record<ViewId, string> = { pano: "Panorámica", mobile: "Móvil", top: "Cenital" };
const CURSOR_COLOR: Record<Tool, number> = {
  ground: 0xf4c542,
  water: 0x4cc9ff,
  relief: 0x9be564,
  object: 0xffffff,
  select: 0xffffff,
  creature: 0xff8fd8,
  erase: 0xff6b6b,
  nav: 0xffffff,
};
const STATUS: Record<Tool, string> = {
  ground: "Pinta el suelo: camino, arena, roca o vuelve a pasto.",
  water: "Agua: las orillas se redondean solas. Clic derecho o Mayús para orbitar.",
  relief: "Relieve: subir crea un montículo con tierra en los bordes y pasto arriba.",
  object: "Coloca el objeto elegido sobre la baldosa.",
  select: "Selecciona un objeto y arrástralo para moverlo.",
  creature: "Mueve a mammal.exe a otra baldosa.",
  erase: "Borra objetos o devuelve la baldosa a su estado original.",
  nav: "Arrastra para orbitar, rueda o pellizco para acercar.",
};

export function HabitatEditor({ registry }: { registry: Registry }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<HabitatWorld | null>(null);
  const undoRef = useRef<SceneData[]>([]);
  const redoRef = useRef<SceneData[]>([]);
  const saveTimer = useRef(0);

  const [panes, setPanes] = useState<Pane[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [tool, setTool] = useState<Tool>("relief");
  const [sub, setSub] = useState<Sub>("up");
  const [brush, setBrush] = useState(1);
  const [objectKey, setObjectKey] = useState<AssetKey>("tree");
  const [mode, setMode] = useState<ViewMode>("triple");
  const [period, setPeriod] = useState<WorldPeriod>("Evening");
  const [grid, setGrid] = useState(true);
  const [lake, setLake] = useState(true);
  const [trail, setTrail] = useState(true);
  const [selected, setSelected] = useState<PropEntry | null>(null);
  const [, bump] = useState(0);
  const [counts, setCounts] = useState({ undo: 0, redo: 0 });
  const [activeView, setActiveView] = useState<ViewId>("pano");

  const stateRef = useRef({ tool, sub, brush, objectKey });
  stateRef.current = { tool, sub, brush, objectKey };

  const atlas = useEvolutionTree(0, registry.activeVersions[0] ?? 0, false);
  const mammal = atlas.tree?.evolutions.find(
    (e) => e.key === "mammal.exe" || e.name.toLowerCase() === "mammal.exe",
  );
  // The creature comes from the atlas: the GLB published on Irys, never a bundled file.
  const creatureUri = mammal?.assets?.modelUri || mammal?.modelUri || "";
  const atlasSettled = !!atlas.tree || !!atlas.error;

  const syncCounts = () => setCounts({ undo: undoRef.current.length, redo: redoRef.current.length });
  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const world = worldRef.current;
      if (!world) return;
      try {
        localStorage.setItem(STORAGE, JSON.stringify(world.snapshot()));
      } catch {
        /* storage full or blocked: the editor keeps working */
      }
    }, 400);
  }, []);
  const remember = (before: SceneData) => {
    undoRef.current.push(before);
    if (undoRef.current.length > 60) undoRef.current.shift();
    redoRef.current = [];
    syncCounts();
    scheduleSave();
  };

  // ---- World lifecycle ---------------------------------------------------------
  useEffect(() => {
    const host = hostRef.current,
      canvas = canvasRef.current;
    if (!host || !canvas) return;
    let alive = true;
    let saved: SceneData | null = null;
    try {
      const raw = localStorage.getItem(STORAGE);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (HabitatWorld.isSceneData(parsed)) saved = parsed;
    } catch {
      saved = null;
    }
    const world = new HabitatWorld(host, canvas, {
      onLayout: (p) => setPanes(p),
      onError: (m) => setError(m),
    });
    worldRef.current = world;
    if (saved) {
      setPeriod(saved.period);
      setLake(saved.lake);
      setTrail(saved.trail);
    }
    world
      .init(saved)
      .then(() => {
        if (!alive) return;
        setLightingState({ ...world.lighting });
        setReady(true);
        bump((n) => n + 1);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
      window.clearTimeout(saveTimer.current);
      world.dispose();
      worldRef.current = null;
    };
  }, []);

  // The real mammal.exe at the centre of the scene, loaded from its Irys URI in the atlas.
  useEffect(() => {
    const world = worldRef.current;
    if (!ready || !world || !atlasSettled) return;
    if (!creatureUri) {
      setError(
        atlas.error
          ? `No se pudo leer el atlas: ${atlas.error}`
          : "mammal.exe no tiene un GLB (URI de Irys) enlazado en el atlas.",
      );
      return;
    }
    let alive = true;
    const l = loader();
    setError("");
    l.gltf
      .loadAsync(creatureUri)
      .then((gltf) => alive && world.setCreature(inspectModel(gltf)))
      .catch(() => alive && setError(`No se pudo cargar el GLB de mammal.exe desde ${creatureUri}`));
    return () => {
      alive = false;
      l.dispose();
    };
  }, [ready, creatureUri, atlasSettled, atlas.error]);

  const [lighting, setLightingState] = useState<Lighting>({ ...DEFAULT_LIGHTING });
  const light = (change: Partial<Lighting>) => {
    setLightingState((prev) => ({ ...prev, ...change }));
    worldRef.current?.setLighting(change);
    scheduleSave();
  };

  // ---- Controls pushed into the world -------------------------------------------
  useEffect(() => {
    if (ready) worldRef.current?.setMode(mode, activeView);
  }, [ready, mode, activeView]);
  useEffect(() => {
    if (ready) void worldRef.current?.setPeriod(period).then(() => scheduleSave());
  }, [ready, period, scheduleSave]);
  useEffect(() => {
    if (ready) worldRef.current?.setGrid(grid);
  }, [ready, grid]);
  useEffect(() => {
    if (!ready) return;
    worldRef.current?.setOriginals({ lake, trail });
    scheduleSave();
  }, [ready, lake, trail, scheduleSave]);

  const pickTool = (t: Tool, s?: Sub) => {
    setTool(t);
    if (s) setSub(s);
    worldRef.current?.hideCursor();
  };

  // ---- History -------------------------------------------------------------------
  const applySnapshot = async (data: SceneData) => {
    const world = worldRef.current;
    if (!world) return;
    await world.restore(data);
    setPeriod(data.period);
    setLake(data.lake);
    setTrail(data.trail);
    setSelected(null);
    bump((n) => n + 1);
    scheduleSave();
  };
  const undo = useCallback(async () => {
    const world = worldRef.current,
      prev = undoRef.current.pop();
    if (!world || !prev) return;
    redoRef.current.push(world.snapshot());
    syncCounts();
    await applySnapshot(prev);
  }, []);
  const redo = useCallback(async () => {
    const world = worldRef.current,
      next = redoRef.current.pop();
    if (!world || !next) return;
    undoRef.current.push(world.snapshot());
    syncCounts();
    await applySnapshot(next);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /INPUT|SELECT|TEXTAREA/.test(el.tagName) && (el as HTMLInputElement).type !== "range") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void (e.shiftKey ? redo() : undo());
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        void redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && worldRef.current?.selected) {
        const world = worldRef.current;
        remember(world.snapshot());
        world.removeProp(world.selected!);
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // ---- Pointer ---------------------------------------------------------------------
  const drag = useRef<{
    kind: "edit" | "orbit" | "pan" | "move";
    pane: Pane;
    x: number;
    y: number;
    before: SceneData | null;
    visited: Set<number>;
    changed: boolean;
    entry?: PropEntry;
  } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = hostRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const edit = (world: HabitatWorld, pane: Pane, x: number, y: number, first: boolean) => {
    const d = drag.current!;
    const hit = world.pickGround(x, y, pane);
    if (!hit) return;
    const { tool: t, sub: s, brush: b, objectKey: k } = stateRef.current;
    const tiles = world.brushTiles(hit.i, hit.j, b);
    if (t === "ground") {
      const g: Ground = s === "path" || s === "sand" || s === "rock" ? s : "grass";
      d.changed = world.paintGround(tiles, g, d.visited) || d.changed;
    } else if (t === "water") {
      d.changed = world.paintWater(tiles, s !== "remove", d.visited) || d.changed;
    } else if (t === "relief") {
      d.changed = world.sculpt(tiles, s !== "down", d.visited) || d.changed;
    } else if (t === "erase") {
      const prop = first ? world.pickProp(x, y, pane) : null;
      if (prop) {
        world.removeProp(prop);
        d.changed = true;
        return;
      }
      d.changed = world.resetTiles(tiles, d.visited) || d.changed;
    } else if (t === "object" && first) {
      void world.addProp(k, hit.x, hit.z).then((entry) => {
        if (entry) {
          world.select(entry);
          setSelected(entry);
        }
      });
      d.changed = true;
    } else if (t === "creature") {
      d.changed = world.moveCreature(hit.x, hit.z) !== false || d.changed;
    }
    if (t === "ground" || t === "water" || t === "relief" || t === "erase") world.refreshTerrain();
  };

  const onDown = (e: React.PointerEvent) => {
    const world = worldRef.current;
    if (!world || !ready) return;
    const { x, y } = local(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    touches.current.set(e.pointerId, { x, y });
    if (touches.current.size === 2) {
      drag.current = null;
      const [a, b] = [...touches.current.values()];
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
      return;
    }
    const pane = world.paneAt(x, y);
    if (!pane) return;
    world.activeView = pane.id;
    setActiveView(pane.id);
    const t = stateRef.current.tool;
    const navigate = e.button === 2 || e.shiftKey || t === "nav" || e.button === 1;
    const base = { pane, x, y, before: null, visited: new Set<number>(), changed: false };
    if (navigate) {
      drag.current = { ...base, kind: e.button === 1 || (e.shiftKey && e.button === 0) ? "pan" : "orbit" };
      return;
    }
    if (t === "select") {
      const entry = world.pickProp(x, y, pane);
      world.select(entry);
      setSelected(entry);
      if (entry) drag.current = { ...base, kind: "move", before: world.snapshot(), entry };
      else drag.current = { ...base, kind: "orbit" };
      return;
    }
    drag.current = { ...base, kind: "edit", before: world.snapshot() };
    edit(world, pane, x, y, true);
  };

  const onMove = (e: React.PointerEvent) => {
    const world = worldRef.current;
    if (!world || !ready) return;
    const { x, y } = local(e);
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x, y });
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current > 0) world.zoom(world.activeView, pinch.current / dist);
      pinch.current = dist;
      return;
    }
    const d = drag.current;
    if (d) {
      const dx = x - d.x,
        dy = y - d.y;
      if (d.kind === "orbit") world.orbit(d.pane.id, dx, dy);
      else if (d.kind === "pan") world.pan(d.pane.id, dx, dy, d.pane);
      else if (d.kind === "move" && d.entry) {
        const hit = world.pickGround(x, y, d.pane);
        if (hit) {
          world.moveProp(d.entry, hit.x, hit.z);
          d.changed = true;
        }
      } else if (d.kind === "edit") edit(world, d.pane, x, y, false);
      d.x = x;
      d.y = y;
      return;
    }
    // Hover cursor
    const pane = world.paneAt(x, y);
    const t = stateRef.current.tool;
    if (!pane || t === "nav" || t === "select") return world.hideCursor();
    const hit = world.pickGround(x, y, pane);
    if (!hit) return world.hideCursor();
    const size = t === "object" || t === "creature" ? 1 : stateRef.current.brush;
    world.showCursor(world.brushTiles(hit.i, hit.j, size), CURSOR_COLOR[t]);
  };

  const onUp = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = 0;
    const world = worldRef.current,
      d = drag.current;
    drag.current = null;
    if (!world || !d) return;
    if (d.changed && d.before) {
      if (d.kind === "edit") world.commitTerrain();
      remember(d.before);
      setSelected(world.selected);
      bump((n) => n + 1);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const world = worldRef.current;
    if (!world) return;
    const { x, y } = local(e);
    const pane = world.paneAt(x, y);
    if (!pane) return;
    world.zoom(pane.id, e.deltaY > 0 ? 1.1 : 1 / 1.1);
  };

  // ---- Files -----------------------------------------------------------------------
  const exportJson = () => {
    const world = worldRef.current;
    if (!world) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(world.snapshot(), null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "habitat-scene.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importJson = async (file: File | undefined) => {
    const world = worldRef.current;
    if (!file || !world) return;
    try {
      const data: unknown = JSON.parse(await file.text());
      if (!HabitatWorld.isSceneData(data)) throw new Error("Archivo de escena no válido.");
      remember(world.snapshot());
      await applySnapshot(data);
      if (data.lighting) light({ ...DEFAULT_LIGHTING, ...data.lighting });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo importar el archivo.");
    }
  };

  const entry = selected;
  const Btn = (p: { t: Tool; s?: Sub; icon: React.ReactNode; label: string }) => (
    <button
      type="button"
      className={`hx-btn${tool === p.t && (!p.s || sub === p.s) ? " on" : ""}`}
      onClick={() => pickTool(p.t, p.s)}
    >
      {p.icon}
      {p.label}
    </button>
  );

  return (
    <div className="hx">
      <aside className="hx-panel">
        <section>
          <h3>Vistas</h3>
          <div className="hx-grid">
            {(["triple", "pano", "mobile", "top"] as ViewMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`hx-btn${mode === m ? " on" : ""}`}
                onClick={() => setMode(m)}
              >
                {m === "triple" ? "Las tres" : VIEW_LABEL[m]}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>Herramientas</h3>
          <div className="hx-grid">
            <Btn t="relief" s="up" icon={<Mountain size={15} />} label="Subir" />
            <Btn t="relief" s="down" icon={<Mountain size={15} style={{ transform: "scaleY(-1)" }} />} label="Bajar" />
            <Btn t="water" s="add" icon={<Droplets size={15} />} label="Agua" />
            <Btn t="water" s="remove" icon={<Droplets size={15} opacity={0.5} />} label="Quitar agua" />
            <Btn t="ground" s="path" icon={<Paintbrush size={15} />} label="Camino" />
            <Btn t="ground" s="sand" icon={<Paintbrush size={15} />} label="Arena" />
            <Btn t="ground" s="rock" icon={<Paintbrush size={15} />} label="Roca" />
            <Btn t="ground" s="grass" icon={<Paintbrush size={15} />} label="Pasto" />
            <Btn t="object" icon={<Trees size={15} />} label="Objeto" />
            <Btn t="select" icon={<MousePointer2 size={15} />} label="Seleccionar" />
            <Btn t="creature" icon={<PawPrint size={15} />} label="Criatura" />
            <Btn t="erase" icon={<Eraser size={15} />} label="Borrar" />
            <Btn t="nav" icon={<Hand size={15} />} label="Navegar" />
          </div>
        </section>

        {(tool === "ground" || tool === "water" || tool === "relief" || tool === "erase") && (
          <section>
            <h3>Pincel</h3>
            <div className="hx-grid three">
              {[1, 3, 5].map((n) => (
                <button key={n} type="button" className={`hx-btn${brush === n ? " on" : ""}`} onClick={() => setBrush(n)}>
                  {n}×{n}
                </button>
              ))}
            </div>
          </section>
        )}

        {tool === "object" && (
          <section>
            <h3>Objeto de la escena</h3>
            <div className="hx-grid">
              {PROP_CATALOG.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`hx-btn${objectKey === p.key ? " on" : ""}`}
                  onClick={() => setObjectKey(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {entry && (
          <section>
            <h3>Objeto seleccionado</h3>
            <label className="hx-field">
              Tamaño ({entry.h.toFixed(1)} m)
              <input
                type="range"
                min={0.2}
                max={10}
                step={0.1}
                value={entry.h}
                onPointerDown={() => worldRef.current && remember(worldRef.current.snapshot())}
                onChange={(e) => {
                  worldRef.current?.updateProp(entry, { h: Number(e.target.value) });
                  bump((n) => n + 1);
                  scheduleSave();
                }}
              />
            </label>
            <label className="hx-field">
              Rotación
              <input
                type="range"
                min={0}
                max={6.28}
                step={0.05}
                value={entry.r}
                onPointerDown={() => worldRef.current && remember(worldRef.current.snapshot())}
                onChange={(e) => {
                  worldRef.current?.updateProp(entry, { r: Number(e.target.value) });
                  bump((n) => n + 1);
                  scheduleSave();
                }}
              />
            </label>
            <button
              type="button"
              className="hx-btn danger"
              onClick={() => {
                const world = worldRef.current;
                if (!world) return;
                remember(world.snapshot());
                world.removeProp(entry);
                setSelected(null);
              }}
            >
              Eliminar objeto
            </button>
          </section>
        )}

        <section>
          <h3>Iluminación</h3>
          <div className="hx-grid">
            {PERIODS.map((p) => (
              <button key={p} type="button" className={`hx-btn${period === p ? " on" : ""}`} onClick={() => setPeriod(p)}>
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
          {(
            [
              ["sun", "Sol", 0, 2.5, 0.05],
              ["ambient", "Luz ambiente", 0, 2.5, 0.05],
              ["rim", "Contraluz", 0, 3, 0.05],
              ["exposure", "Brillo general", 0.5, 1.8, 0.02],
              ["warmth", "Frío ↔ cálido", -1, 1, 0.05],
              ["azimuth", "Giro del sol", -180, 180, 1],
              ["elevation", "Altura del sol", -40, 40, 1],
            ] as const
          ).map(([k, label, min, max, step]) => (
            <label key={k} className="hx-field" style={{ marginTop: 6 }}>
              {label}
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={lighting[k]}
                onChange={(e) => light({ [k]: Number(e.target.value) })}
              />
            </label>
          ))}
          <div className="hx-grid" style={{ marginTop: 8 }}>
            <button
              type="button"
              className={`hx-btn${lighting.shadows ? " on" : ""}`}
              onClick={() => light({ shadows: !lighting.shadows })}
            >
              Sombras
            </button>
            <button type="button" className="hx-btn" onClick={() => light({ ...DEFAULT_LIGHTING })}>
              Restablecer
            </button>
          </div>
        </section>

        <section>
          <h3>Escena</h3>
          <div className="hx-grid">
            <button type="button" className={`hx-btn${grid ? " on" : ""}`} onClick={() => setGrid(!grid)}>
              <Grid3X3 size={15} /> Cuadrícula
            </button>
            <button type="button" className={`hx-btn${lake ? " on" : ""}`} onClick={() => setLake(!lake)}>
              <Layers size={15} /> Lago original
            </button>
            <button type="button" className={`hx-btn${trail ? " on" : ""}`} onClick={() => setTrail(!trail)}>
              <Layers size={15} /> Camino original
            </button>
          </div>
        </section>

        <section>
          <h3>Archivo</h3>
          <div className="hx-grid">
            <button type="button" className="hx-btn" disabled={!counts.undo} onClick={() => void undo()}>
              <Undo2 size={15} /> Deshacer
            </button>
            <button type="button" className="hx-btn" disabled={!counts.redo} onClick={() => void redo()}>
              <Redo2 size={15} /> Rehacer
            </button>
            <button type="button" className="hx-btn" onClick={exportJson}>
              <Download size={15} /> Exportar
            </button>
            <label className="hx-btn" style={{ cursor: "pointer" }}>
              <Upload size={15} /> Importar
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  void importJson(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <p className="hx-hint" style={{ marginTop: 8 }}>
            Se guarda solo en este navegador. Clic derecho o Mayús para orbitar, rueda para zoom, doble clic para
            reiniciar la vista.
          </p>
        </section>
      </aside>

      <div
        ref={hostRef}
        className="hx-stage"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => worldRef.current?.hideCursor()}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={(e) => {
          const world = worldRef.current;
          if (!world) return;
          const { x, y } = local(e);
          const pane = world.paneAt(x, y);
          if (pane) world.resetView(pane.id);
        }}
      >
        <canvas ref={canvasRef} />
        {panes.map((p) => (
          <div
            key={p.id}
            className={`hx-label${p.id === activeView && panes.length > 1 ? " active" : ""}`}
            style={{ left: p.x, top: p.y }}
          >
            {VIEW_LABEL[p.id]}
          </div>
        ))}
        {!ready && !error && <div className="hx-loading">Cargando la escena del juego…</div>}
        <div className="hx-status">{error || STATUS[tool]}</div>
      </div>
    </div>
  );
}
