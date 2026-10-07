import {
  Download,
  Droplets,
  Eraser,
  Eye,
  Grid3X3,
  Hand,
  Lock,
  Mountain,
  MousePointer2,
  Paintbrush,
  Redo2,
  Sprout,
  Sun,
  Trash2,
  Trees,
  Undo2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PERIODS, type WorldPeriod } from "../../hooks/useWorldClock";
import { useEvolutionTree } from "../../hooks/useEvolutionTree";
import { inspectModel, loader } from "../../lib/assets/rig";
import type { Registry } from "../../lib/rebyters/types";
import type { AssetKey } from "../assets/meadow";
import "./habitat/HabitatEditor.css";
import {
  COVER,
  DEFAULT_LIGHTING,
  DIORAMA_SIZES,
  HabitatWorld,
  PROP_CATALOG,
  type DioramaSize,
  type Lighting,
  type Pane,
  type PropEntry,
  type SceneData,
  type ViewId,
  type ViewMode,
} from "./habitat/world";
import { OX, OZ, type Ground } from "./habitat/tiles";

// ---- Tool definitions -------------------------------------------------------------
// One table drives the toolbox, its options, the shortcuts and the hints.

type ToolId = "select" | "relief" | "water" | "ground" | "grass" | "object" | "erase" | "nav";
type Mode = { id: string; label: string };
type ToolDef = {
  id: ToolId;
  label: string;
  key: string;
  icon: ReactNode;
  hint: string;
  brush: boolean;
  modes?: Mode[];
};

const TOOLS: ToolDef[] = [
  {
    id: "select",
    label: "Seleccionar",
    key: "V",
    icon: <MousePointer2 size={18} />,
    hint: "Haz clic en la criatura o en un objeto y arrástralo para moverlo.",
    brush: false,
  },
  {
    id: "relief",
    label: "Relieve",
    key: "R",
    icon: <Mountain size={18} />,
    hint: "Cada clic sube o baja una baldosa. Los montículos llevan tierra en los bordes y pasto arriba.",
    brush: true,
    modes: [
      { id: "up", label: "Subir" },
      { id: "down", label: "Bajar" },
    ],
  },
  {
    id: "water",
    label: "Agua",
    key: "A",
    icon: <Droplets size={18} />,
    hint: "Pinta agua. Las orillas se redondean solas y no puede cubrir objetos ni a la criatura.",
    brush: true,
    modes: [
      { id: "add", label: "Agregar" },
      { id: "remove", label: "Quitar" },
    ],
  },
  {
    id: "ground",
    label: "Suelo",
    key: "G",
    icon: <Paintbrush size={18} />,
    hint: "Pinta el material del suelo. «Césped» quita la pintura.",
    brush: true,
    modes: [
      { id: "path", label: "Camino" },
      { id: "sand", label: "Arena" },
      { id: "rock", label: "Roca" },
      { id: "grass", label: "Césped" },
    ],
  },
  {
    id: "grass",
    label: "Pasto alto",
    key: "P",
    icon: <Sprout size={18} />,
    hint: "Pon matas de pasto alto donde quieras, o quítalas junto con la alfombra de pasto.",
    brush: true,
    modes: [
      { id: "tuft", label: "Poner" },
      { id: "untuft", label: "Quitar" },
    ],
  },
  {
    id: "object",
    label: "Objetos",
    key: "O",
    icon: <Trees size={18} />,
    hint: "Elige un objeto abajo y haz clic en una baldosa libre para colocarlo.",
    brush: false,
  },
  {
    id: "erase",
    label: "Borrar",
    key: "E",
    icon: <Eraser size={18} />,
    hint: "Borra el objeto sobre el que hagas clic, o todos los de la zona si el pincel es grande.",
    brush: true,
  },
  {
    id: "nav",
    label: "Cámara",
    key: "H",
    icon: <Hand size={18} />,
    hint: "Arrastra para orbitar. También: clic derecho o Mayús para mover, rueda para acercar.",
    brush: false,
  },
];

const STORAGE = "habitat-dioramas-v2";
const LAST = "habitat-last-size-v2";
const PERIOD_LABEL: Record<WorldPeriod, string> = {
  Night: "Noche",
  Morning: "Mañana",
  Day: "Día",
  Evening: "Atardecer",
};
const VIEW_LABEL: Record<ViewId, string> = { pano: "Panorámica", mobile: "Móvil", top: "Cenital" };
const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: "triple", label: "Las tres" },
  { id: "pano", label: "Panorámica" },
  { id: "mobile", label: "Móvil" },
  { id: "top", label: "Cenital" },
];
const CURSOR_COLOR: Record<ToolId, number> = {
  select: 0xffffff,
  relief: 0x9be564,
  water: 0x4cc9ff,
  ground: 0xf4c542,
  grass: 0x9be564,
  object: 0xffffff,
  erase: 0xff6b6b,
  nav: 0xffffff,
};
const LIGHT_SLIDERS: [keyof Omit<Lighting, "shadows">, string, number, number, number][] = [
  ["sun", "Sol", 0, 2.5, 0.05],
  ["ambient", "Luz ambiente", 0, 2.5, 0.05],
  ["rim", "Contraluz", 0, 3, 0.05],
  ["exposure", "Brillo general", 0.5, 1.8, 0.02],
  ["warmth", "Frío ↔ cálido", -1, 1, 0.05],
  ["azimuth", "Giro del sol", -180, 180, 1],
  ["elevation", "Altura del sol", -40, 40, 1],
];

type Stored = Partial<Record<string, SceneData>>;
const readStore = (): Stored => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? "{}");
    return raw && typeof raw === "object" ? (raw as Stored) : {};
  } catch {
    return {};
  }
};
const storedScene = (size: DioramaSize): SceneData | null => {
  const data = readStore()[String(size)];
  return HabitatWorld.isSceneData(data) && data.size === size ? data : null;
};
const lastSize = (): DioramaSize => {
  try {
    const n = Number(localStorage.getItem(LAST));
    return (DIORAMA_SIZES as number[]).includes(n) ? (n as DioramaSize) : 8;
  } catch {
    return 8;
  }
};

type Drag =
  | { kind: "orbit"; pane: Pane; x: number; y: number }
  | { kind: "pan"; pane: Pane; x: number; y: number }
  | {
      kind: "brush";
      pane: Pane;
      before: SceneData;
      visited: Set<number>;
      cover: Set<number>;
      changed: boolean;
    }
  | {
      kind: "move";
      pane: Pane;
      before: SceneData;
      entry: PropEntry | null; // null = the creature
      off: { i: number; j: number };
      changed: boolean;
    };

export function HabitatEditor({ registry }: { registry: Registry }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<HabitatWorld | null>(null);
  const undoRef = useRef<SceneData[]>([]);
  const redoRef = useRef<SceneData[]>([]);
  const saveTimer = useRef(0);
  const noticeTimer = useRef(0);
  const drag = useRef<Drag | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  const toolBefore = useRef<ToolId>("relief");

  const [panes, setPanes] = useState<Pane[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tool, setTool] = useState<ToolId>("relief");
  const [modes, setModes] = useState<Record<string, string>>({
    relief: "up",
    water: "add",
    ground: "path",
    grass: "tuft",
  });
  const [brush, setBrush] = useState(1);
  const [objectKey, setObjectKey] = useState<AssetKey>("tree");
  const [view, setView] = useState<ViewMode>("triple");
  const [activeView, setActiveView] = useState<ViewId>("pano");
  const [size, setSize] = useState<DioramaSize>(lastSize);
  const [previewing, setPreviewing] = useState(false);
  const [period, setPeriod] = useState<WorldPeriod>("Evening");
  const [lighting, setLightingState] = useState<Lighting>({ ...DEFAULT_LIGHTING });
  const [lightOpen, setLightOpen] = useState(false);
  const [grid, setGrid] = useState(true);
  const [playerView, setPlayerView] = useState(false);
  const gridBefore = useRef(true);
  const [selected, setSelected] = useState<PropEntry | null>(null);
  const [creatureOn, setCreatureOn] = useState(false);
  const [counts, setCounts] = useState({ undo: 0, redo: 0 });
  const [, bump] = useState(0);

  const live = useRef({ tool, modes, brush, objectKey, previewing });
  live.current = { tool, modes, brush, objectKey, previewing };

  const atlas = useEvolutionTree(0, registry.activeVersions[0] ?? 0, false);
  const mammal = atlas.tree?.evolutions.find(
    (e) => e.key === "mammal.exe" || e.name.toLowerCase() === "mammal.exe",
  );
  // The creature comes from the atlas: the GLB published on Irys, never a bundled file.
  const creatureUri = mammal?.assets?.modelUri || mammal?.modelUri || "";
  const atlasSettled = !!atlas.tree || !!atlas.error;

  const def = TOOLS.find((t) => t.id === tool)!;
  const mode = modes[tool];

  // ---- Saving ----------------------------------------------------------------------
  const save = useCallback(() => {
    const world = worldRef.current;
    if (!world || world.kind !== "diorama") return;
    try {
      const store = readStore();
      store[String(world.size)] = world.snapshot();
      localStorage.setItem(STORAGE, JSON.stringify(store));
      localStorage.setItem(LAST, String(world.size));
    } catch {
      /* storage full or blocked: the editor keeps working */
    }
  }, []);
  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(save, 400);
  }, [save]);
  const flushSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    save();
  }, [save]);

  const syncCounts = () => setCounts({ undo: undoRef.current.length, redo: redoRef.current.length });
  const remember = (before: SceneData) => {
    undoRef.current.push(before);
    if (undoRef.current.length > 80) undoRef.current.shift();
    redoRef.current = [];
    syncCounts();
    scheduleSave();
  };
  const resetHistory = () => {
    undoRef.current = [];
    redoRef.current = [];
    syncCounts();
  };

  // ---- World lifecycle ---------------------------------------------------------------
  useEffect(() => {
    const host = hostRef.current,
      canvas = canvasRef.current;
    if (!host || !canvas) return;
    let alive = true;
    const initial = lastSize();
    const data = storedScene(initial);
    const world = new HabitatWorld(host, canvas, {
      onLayout: (p) => setPanes(p),
      onError: (m) => setError(m),
      onNotice: (m) => {
        setNotice(m);
        window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(""), 2600);
      },
    });
    worldRef.current = world;
    world
      .init({ kind: "diorama", size: initial, data })
      .then(() => {
        if (!alive) return;
        setPeriod(world.period);
        setLightingState({ ...world.lighting });
        setReady(true);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
      window.clearTimeout(saveTimer.current);
      window.clearTimeout(noticeTimer.current);
      world.dispose();
      worldRef.current = null;
    };
  }, []);

  // The real mammal.exe, loaded from its Irys URI in the atlas.
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

  useEffect(() => {
    if (ready) worldRef.current?.setMode(view, activeView);
  }, [ready, view, activeView]);
  useEffect(() => {
    if (!ready) return;
    void worldRef.current?.setPeriod(period).then(scheduleSave);
  }, [ready, period, scheduleSave]);
  useEffect(() => {
    if (ready) worldRef.current?.setGrid(grid);
  }, [ready, grid]);
  /** The camera as the player has it in the game: fixed, no grid. */
  const togglePlayerView = () => {
    const on = !playerView;
    worldRef.current?.setPlayerView(on);
    setPlayerView(on);
    if (on) {
      gridBefore.current = grid;
      setGrid(false);
      if (view === "top") setView("triple");
    } else setGrid(gridBefore.current);
  };

  const light = (change: Partial<Lighting>) => {
    setLightingState((prev) => ({ ...prev, ...change }));
    worldRef.current?.setLighting(change);
    scheduleSave();
  };

  // ---- Scenes ------------------------------------------------------------------------
  const clearSelection = () => {
    setSelected(null);
    setCreatureOn(false);
  };
  /** Opens a diorama size, or the game's own scene as a read-only preview. */
  const openScene = async (next: DioramaSize | "preview") => {
    const world = worldRef.current;
    if (!world || busy) return;
    if (next === "preview" ? previewing : !previewing && next === size) return;
    flushSave();
    setBusy(true);
    clearSelection();
    resetHistory();
    try {
      if (next === "preview") {
        await world.open({ kind: "preview" });
        toolBefore.current = tool;
        setTool("nav");
        setPreviewing(true);
      } else {
        await world.open({ kind: "diorama", size: next, data: storedScene(next) });
        if (previewing) setTool(toolBefore.current);
        setPreviewing(false);
        setSize(next);
        setPeriod(world.period);
        setLightingState({ ...world.lighting });
        save();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const applySnapshot = async (data: SceneData) => {
    const world = worldRef.current;
    if (!world) return;
    await world.restore(data);
    setPeriod(data.period);
    clearSelection();
    bump((n) => n + 1);
    scheduleSave();
  };
  const undo = useCallback(async () => {
    const world = worldRef.current,
      prev = undoRef.current.pop();
    if (!world || !prev || live.current.previewing) return;
    redoRef.current.push(world.snapshot());
    syncCounts();
    await applySnapshot(prev);
  }, []);
  const redo = useCallback(async () => {
    const world = worldRef.current,
      next = redoRef.current.pop();
    if (!world || !next || live.current.previewing) return;
    undoRef.current.push(world.snapshot());
    syncCounts();
    await applySnapshot(next);
  }, []);
  const clearAll = async () => {
    const world = worldRef.current;
    if (!world || previewing) return;
    if (!window.confirm("¿Vaciar el diorama? Podrás deshacerlo con Ctrl+Z.")) return;
    remember(world.snapshot());
    await applySnapshot(HabitatWorld.blank(world.size, world.period));
  };

  // ---- Keyboard ----------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /INPUT|SELECT|TEXTAREA/.test(el.tagName) && (el as HTMLInputElement).type !== "range") return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        void (e.shiftKey ? redo() : undo());
      } else if (mod && k === "y") {
        e.preventDefault();
        void redo();
      } else if (!mod && !live.current.previewing) {
        const hit = TOOLS.find((t) => t.key.toLowerCase() === k);
        if (hit) setTool(hit.id);
        else if ((e.key === "Delete" || e.key === "Backspace") && worldRef.current?.selected) {
          const world = worldRef.current;
          remember(world.snapshot());
          world.removeProp(world.selected!);
          clearSelection();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // ---- Pointer -----------------------------------------------------------------------
  const local = (e: { clientX: number; clientY: number }) => {
    const r = hostRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** Tile under the pointer. Clicking the creature itself means the creature's own tile. */
  const tileAt = (world: HabitatWorld, pane: Pane, x: number, y: number) => {
    if (world.pickCreature(x, y, pane)) {
      const t = world.creatureTile();
      return { i: t.i, j: t.j, x: OX + t.i, z: OZ + t.j };
    }
    return world.pickGround(x, y, pane);
  };

  const brushAction = (world: HabitatWorld, d: Extract<Drag, { kind: "brush" }>, x: number, y: number, first: boolean) => {
    const { tool: t, modes: m, brush: b, objectKey: k } = live.current;
    const hit = tileAt(world, d.pane, x, y);
    if (!hit) return;
    const tiles = world.brushTiles(hit.i, hit.j, t === "object" ? 1 : b);
    const sub = m[t];
    if (t === "relief") d.changed = world.sculpt(tiles, sub !== "down", d.visited) || d.changed;
    else if (t === "water") d.changed = world.paintWater(tiles, sub !== "remove", d.visited) || d.changed;
    else if (t === "ground") d.changed = world.paintGround(tiles, sub as Ground, d.visited) || d.changed;
    else if (t === "grass") {
      if (sub === "tuft") {
        world.paintCut(tiles, false, d.visited);
        d.changed = true;
        void world.addCover("grass", tiles, d.cover);
      } else {
        d.changed = world.paintCut(tiles, true, d.visited) || d.changed;
        d.changed = world.eraseProps(tiles, ["grass"]) > 0 || d.changed;
      }
    } else if (t === "erase") {
      const prop = first && b === 1 ? world.pickProp(x, y, d.pane) : null;
      if (prop) {
        world.removeProp(prop);
        d.changed = true;
      } else d.changed = world.eraseProps(tiles) > 0 || d.changed;
    } else if (t === "object") {
      if (COVER.includes(k)) {
        d.changed = true;
        void world.addCover(k, tiles, d.cover);
      } else if (first) {
        d.changed = true;
        void world.addProp(k, hit.x, hit.z).then((entry) => {
          if (entry) {
            world.select(entry);
            setSelected(entry);
            setCreatureOn(false);
          } else bump((n) => n + 1);
        });
      }
    }
    if (t !== "object") world.refreshTerrain();
    else if (COVER.includes(k)) world.refreshTerrain();
  };

  const onDown = (e: React.PointerEvent) => {
    const world = worldRef.current;
    if (!world || !ready || busy) return;
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
    const t = live.current.tool;
    const pan = e.button === 1 || (e.shiftKey && e.button === 0);
    if (!world.editable || t === "nav" || e.button === 2 || pan) {
      drag.current = pan ? { kind: "pan", pane, x, y } : { kind: "orbit", pane, x, y };
      return;
    }
    if (t === "select") {
      const onCreature = world.pickCreature(x, y, pane);
      const entry = onCreature ? null : world.pickProp(x, y, pane);
      if (!onCreature && !entry) {
        world.select(null);
        world.selectCreature(false);
        clearSelection();
        drag.current = { kind: "orbit", pane, x, y };
        return;
      }
      if (onCreature) {
        world.selectCreature(true);
        setSelected(null);
        setCreatureOn(true);
      } else {
        world.select(entry);
        setSelected(entry);
        setCreatureOn(false);
      }
      const ground = world.pickGround(x, y, pane);
      const origin = onCreature
        ? world.creatureTile()
        : entry
          ? { i: Math.round(entry.x - OX), j: Math.round(entry.z - OZ) }
          : { i: 0, j: 0 };
      drag.current = {
        kind: "move",
        pane,
        before: world.snapshot(),
        entry,
        // The ray through a tall body lands behind it: remember that offset so the grab feels exact.
        off: ground ? { i: ground.i - origin.i, j: ground.j - origin.j } : { i: 0, j: 0 },
        changed: false,
      };
      return;
    }
    const d: Extract<Drag, { kind: "brush" }> = {
      kind: "brush",
      pane,
      before: world.snapshot(),
      visited: new Set(),
      cover: new Set(),
      changed: false,
    };
    drag.current = d;
    brushAction(world, d, x, y, true);
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
      if (d.kind === "orbit" || d.kind === "pan") {
        const dx = x - d.x,
          dy = y - d.y;
        if (d.kind === "orbit") world.orbit(d.pane.id, dx, dy);
        else world.pan(d.pane.id, dx, dy, d.pane);
        d.x = x;
        d.y = y;
      } else if (d.kind === "move") {
        const hit = world.pickGround(x, y, d.pane);
        if (hit) {
          const i = hit.i - d.off.i,
            j = hit.j - d.off.j;
          const wx = OX + i,
            wz = OZ + j;
          const moved = d.entry ? world.moveProp(d.entry, wx, wz) : world.moveCreature(wx, wz);
          if (moved) d.changed = true;
        }
      } else brushAction(world, d, x, y, false);
      return;
    }
    // Hover feedback
    const el = hostRef.current;
    const pane = world.paneAt(x, y);
    const t = live.current.tool;
    if (!pane || !world.editable || t === "nav") {
      world.hideCursor();
      if (el) el.style.cursor = t === "nav" ? "grab" : "";
      return;
    }
    if (t === "select") {
      world.hideCursor();
      const over = world.pickCreature(x, y, pane) || !!world.pickProp(x, y, pane);
      if (el) el.style.cursor = over ? "grab" : "";
      return;
    }
    if (el) el.style.cursor = "crosshair";
    const hit = tileAt(world, pane, x, y);
    if (!hit) return world.hideCursor();
    const sz = t === "object" ? 1 : live.current.brush;
    world.showCursor(world.brushTiles(hit.i, hit.j, sz), CURSOR_COLOR[t]);
  };

  const onUp = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = 0;
    const world = worldRef.current,
      d = drag.current;
    drag.current = null;
    if (!world || !d || d.kind === "orbit" || d.kind === "pan") return;
    if (d.changed) {
      world.commitTerrain();
      remember(d.before);
      bump((n) => n + 1);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const world = worldRef.current;
    if (!world) return;
    const { x, y } = local(e);
    const pane = world.paneAt(x, y);
    if (pane) world.zoom(pane.id, e.deltaY > 0 ? 1.1 : 1 / 1.1);
  };

  // ---- Files -------------------------------------------------------------------------
  const exportJson = () => {
    const world = worldRef.current;
    if (!world || previewing) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(world.snapshot(), null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `diorama-${world.size}x${world.size}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importJson = async (file: File | undefined) => {
    const world = worldRef.current;
    if (!file || !world) return;
    try {
      const data: unknown = JSON.parse(await file.text());
      if (!HabitatWorld.isSceneData(data)) throw new Error("Ese archivo no es un diorama válido.");
      flushSave();
      setBusy(true);
      clearSelection();
      resetHistory();
      await world.open({ kind: "diorama", size: data.size, data });
      setPreviewing(false);
      setSize(data.size);
      setPeriod(world.period);
      setLightingState({ ...world.lighting });
      save();
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo importar el archivo.");
    }
    setBusy(false);
  };

  // ---- Render ------------------------------------------------------------------------
  const world = worldRef.current;
  const status =
    error ||
    notice ||
    (previewing
      ? "Escena de prueba del juego: solo para mirar."
      : playerView
        ? "Cámara del jugador: así lo verá en el juego. Pulsa el botón otra vez para liberar la cámara."
        : def.hint);

  return (
    <div className="hx">
      <header className="hx-bar">
        <div className="hx-group" role="group" aria-label="Tamaño del diorama">
          <span className="hx-label-sm">Diorama</span>
          {DIORAMA_SIZES.map((n) => (
            <button
              key={n}
              type="button"
              className={`hx-seg${!previewing && size === n ? " on" : ""}`}
              disabled={busy}
              onClick={() => void openScene(n)}
              title={`Construir un diorama de ${n}×${n} baldosas`}
            >
              {n}×{n}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`hx-seg wide${previewing ? " on" : ""}`}
          disabled={busy}
          onClick={() => void openScene(previewing ? size : "preview")}
          title="Ver cómo se ve la escena real del juego"
        >
          <Eye size={15} /> {previewing ? "Volver a mi diorama" : "Ver escena de prueba"}
        </button>
        <span className="hx-spacer" />
        <div className="hx-group">
          <button type="button" className="hx-icon" disabled={!counts.undo || previewing} onClick={() => void undo()} title="Deshacer (Ctrl+Z)">
            <Undo2 size={17} />
          </button>
          <button type="button" className="hx-icon" disabled={!counts.redo || previewing} onClick={() => void redo()} title="Rehacer (Ctrl+Y)">
            <Redo2 size={17} />
          </button>
          <button type="button" className="hx-icon" disabled={previewing} onClick={() => void clearAll()} title="Vaciar diorama">
            <Trash2 size={17} />
          </button>
          <button type="button" className="hx-icon" disabled={previewing} onClick={exportJson} title="Exportar diorama (.json)">
            <Download size={17} />
          </button>
          <label className="hx-icon" title="Importar diorama (.json)">
            <Upload size={17} />
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
        <div className="hx-group" role="group" aria-label="Vistas">
          {VIEW_MODES.map((v) => (
            <button key={v.id} type="button" className={`hx-seg${view === v.id ? " on" : ""}`} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`hx-seg wide${playerView ? " on" : ""}`}
          onClick={togglePlayerView}
          title="Fija la cámara como la ve el jugador en el juego (móvil y computadora)"
        >
          <Lock size={15} /> {playerView ? "Cámara del jugador" : "Vista del jugador"}
        </button>
        <button type="button" className={`hx-seg wide${lightOpen ? " on" : ""}`} onClick={() => setLightOpen(!lightOpen)}>
          <Sun size={15} /> Luz
        </button>
        <button type="button" className={`hx-icon${grid ? " on" : ""}`} onClick={() => setGrid(!grid)} title="Cuadrícula">
          <Grid3X3 size={17} />
        </button>
      </header>

      <nav className="hx-rail" aria-label="Herramientas">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`hx-tool${tool === t.id ? " on" : ""}`}
            disabled={previewing && t.id !== "nav"}
            onClick={() => setTool(t.id)}
            title={`${t.label} (${t.key})`}
          >
            {t.icon}
            <span>{t.label}</span>
            <kbd>{t.key}</kbd>
          </button>
        ))}
      </nav>

      <aside className="hx-options">
        {previewing ? (
          <p className="hx-help">
            Estás mirando la escena real del juego. No se puede editar. Usa «Volver a mi diorama» para seguir
            construyendo.
          </p>
        ) : (
          <>
            <h3>{def.label}</h3>
            <p className="hx-help">{def.hint}</p>

            {def.modes && (
              <div className="hx-modes">
                {def.modes.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`hx-seg${mode === m.id ? " on" : ""}`}
                    onClick={() => setModes({ ...modes, [tool]: m.id })}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}

            {def.brush && (
              <div className="hx-field">
                <span>Pincel</span>
                <div className="hx-modes">
                  {[1, 3, 5].map((n) => (
                    <button key={n} type="button" className={`hx-seg${brush === n ? " on" : ""}`} onClick={() => setBrush(n)}>
                      {n}×{n}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tool === "object" && (
              <div className="hx-objects">
                {PROP_CATALOG.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={`hx-seg${objectKey === p.key ? " on" : ""}`}
                    onClick={() => setObjectKey(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}

            {creatureOn && (
              <div className="hx-card">
                <strong>mammal.exe</strong>
                <p className="hx-help">Ocupa una baldosa. Arrástrala para moverla; sube sola con el relieve.</p>
              </div>
            )}

            {selected && (
              <div className="hx-card">
                <strong>{PROP_CATALOG.find((p) => p.key === selected.key)?.label ?? selected.key}</strong>
                <label className="hx-field">
                  <span>Tamaño · {selected.h.toFixed(1)} m</span>
                  <input
                    type="range"
                    min={0.1}
                    max={world?.kind === "diorama" ? 6 : 10}
                    step={0.1}
                    value={selected.h}
                    onPointerDown={() => world && remember(world.snapshot())}
                    onChange={(e) => {
                      world?.updateProp(selected, { h: Number(e.target.value) });
                      bump((n) => n + 1);
                      scheduleSave();
                    }}
                  />
                </label>
                <label className="hx-field">
                  <span>Giro</span>
                  <input
                    type="range"
                    min={0}
                    max={6.28}
                    step={0.05}
                    value={selected.r}
                    onPointerDown={() => world && remember(world.snapshot())}
                    onChange={(e) => {
                      world?.updateProp(selected, { r: Number(e.target.value) });
                      bump((n) => n + 1);
                      scheduleSave();
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="hx-seg danger"
                  onClick={() => {
                    if (!world) return;
                    remember(world.snapshot());
                    world.removeProp(selected);
                    clearSelection();
                  }}
                >
                  Eliminar objeto
                </button>
              </div>
            )}
          </>
        )}
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
          const w = worldRef.current;
          if (!w) return;
          const { x, y } = local(e);
          const pane = w.paneAt(x, y);
          if (pane) w.resetView(pane.id);
        }}
      >
        <canvas ref={canvasRef} />
        {panes.map((p) => (
          <div
            key={p.id}
            className={`hx-tag${p.id === activeView && panes.length > 1 ? " active" : ""}`}
            style={{ left: p.x, top: p.y }}
          >
            {VIEW_LABEL[p.id]}
          </div>
        ))}
        {lightOpen && (
          <div className="hx-light" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
            <h3>Iluminación</h3>
            <div className="hx-modes">
              {PERIODS.map((p) => (
                <button key={p} type="button" className={`hx-seg${period === p ? " on" : ""}`} onClick={() => setPeriod(p)}>
                  {PERIOD_LABEL[p]}
                </button>
              ))}
            </div>
            {LIGHT_SLIDERS.map(([k, label, min, max, step]) => (
              <label key={k} className="hx-field">
                <span>{label}</span>
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
            <div className="hx-modes">
              <button type="button" className={`hx-seg${lighting.shadows ? " on" : ""}`} onClick={() => light({ shadows: !lighting.shadows })}>
                Sombras
              </button>
              <button type="button" className="hx-seg" onClick={() => light({ ...DEFAULT_LIGHTING })}>
                Restablecer
              </button>
            </div>
          </div>
        )}
        {(!ready || busy) && !error && <div className="hx-loading">{busy ? "Cambiando de escena…" : "Cargando…"}</div>}
        <div className={`hx-status${error ? " err" : notice ? " warn" : ""}`}>{status}</div>
      </div>
    </div>
  );
}
