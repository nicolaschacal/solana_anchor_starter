import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Minus, Pencil, Plus, RotateCcw, RotateCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { WorldPeriod } from "../../hooks/useWorldClock";
import { loadEvolutionAsset } from "../player/creatureAsset";
import type { FxAsset } from "../../lib/rebyters/evolution-fx";
import type { Evolution } from "../../lib/rebyters/types";
import { CreatureSprite } from "../admin/CreatureSprite";
import { OX, OZ, TileMap } from "../admin/habitat/tiles";
import { FRONT_FACING, HabitatWorld, facingInward, footprint, spanOf, type PropEntry } from "../admin/habitat/world";
import type { AssetKey } from "../assets/meadow";
import { EMOTES, type Emote } from "../player/emotes";
import { FOV, WorldRig, angleDelta } from "../../lib/world/rig";
import { createWalker, placeWalker, stepWalker, tileTaken, walkerPosition, type Walker } from "../../lib/world/wander";
import { createIsland, type Island } from "./island";
import { createSky, type WorldSky } from "./sky";
import { blendWalk, buildEntity, disposeAsset, disposeObject, playAction, stopAction, type Entity } from "./entity";
import {
  specFor,
  type HabitatSize,
  defaultLayout,
  freeTile,
  limitProps,
  reconcile,
  tileX,
  tileZ,
  type PlacedProp,
  type WorldLayout,
} from "./layout";
import { PROP_KEYS } from "../../lib/rebyters/habitat-layout";

export type WorldCreature = {
  mint: string;
  evolution: Evolution;
  /** What it needs right now, if anything. Shown above its head until it is met. */
  emote: Emote | null;
  /** Happy rebyters show a heart now and then. */
  happy: boolean;
};

type Props = {
  creatures: WorldCreature[];
  /** The layout saved in the wallet's profile, or null if none was ever saved (default scene). */
  initialLayout: WorldLayout | null;
  /** Saves the layout in the wallet's profile; rejects if the player cancels or it fails. */
  onCommitLayout: (layout: WorldLayout) => Promise<unknown>;
  period: WorldPeriod;
  /** The world clock, in ms: twilight follows the real hour. */
  worldTime?: number;
  /** A rebyter was tapped: it becomes the protagonist. */
  onSelect: (mint: string) => void;
  /** The protagonist, if any: the camera stays on it and the world holds still around it. */
  focusMint?: string | null;
  /** The protagonist was tapped again: go back to the open view. */
  onExit?: () => void;
  /** What the protagonist is doing (idle | touch | feed | train | train-power | sad). */
  action?: string;
  /** A one-shot action finished. */
  onActionComplete?: () => void;
  /** How many objects of a kind the player may have placed (Infinity = free). Owned decor comes from the wallet. */
  propAllowance?: (key: AssetKey) => number;
  /** The habitat's size in tiles per side (default 5). It fixes the board, the camera and the limits. */
  size?: HabitatSize;
};

type Selection = { kind: "prop"; entry: PropEntry } | { kind: "creature"; mint: string } | null;

/** The objects a player can add. The game's own props, in the editor's order. */
const PALETTE: AssetKey[] = PROP_KEYS;
const LABELS: Partial<Record<AssetKey, string>> = {
  tree: "Tree",
  pine: "Pine",
  bush: "Berry bush",
  rocks: "Mossy rocks",
  stump: "Stump",
  log: "Hollow log",
  mushrooms: "Mushrooms",
  wildflowers: "Wildflowers",
  lantern: "Lantern",
  vending: "Vending machine",
  busStop: "Bus stop",
};
const labelOf = (key: AssetKey) => LABELS[key] ?? "Object";
const PALETTE_ITEMS = PALETTE.map((key) => ({ key, label: labelOf(key) }));
/** The habitat engine reports in Spanish; the game speaks English. */
const NOTICES: Record<string, string> = {
  "Fuera del diorama.": "That tile is outside the habitat.",
  "Ese objeto no puede ir sobre el agua.": "That can't go on water.",
  "La criatura ocupa esa baldosa.": "A rebyter is standing there.",
  "Ya hay un objeto sólido en esa baldosa.": "There is already an object on that tile.",
};
const TAP_PIXELS = 8;


export function PlayerWorld({ creatures, initialLayout, onCommitLayout, period, worldTime, onSelect, focusMint = null, action = "idle", onActionComplete, onExit, propAllowance, size = 5 }: Props) {
  const spec = useMemo(() => specFor(size), [size]);
  const { board: BOARD, maxPlaced: MAX_PLACED, maxProps: MAX_PROPS, tree: TREE_TILE } = spec;
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const emoteRefs = useRef(new Map<string, HTMLDivElement>());
  const persistRef = useRef<() => void>(() => undefined);
  const editRef = useRef<{ resize: (factor: number) => void; rotate: (delta: number) => void; nudge: (right: number, forward: number) => void } | null>(null);
  const worldRef = useRef<HabitatWorld | null>(null);
  const rigRef = useRef<WorldRig | null>(null);
  const entities = useRef(new Map<string, Entity>());
  const walkers = useRef<Walker[]>([]);
  const assets = useRef(new Map<number, Promise<FxAsset>>());
  const loadedAssets = useRef<FxAsset[]>([]);
  const creaturesRef = useRef(creatures);
  creaturesRef.current = creatures;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const focusRef = useRef<string | null>(focusMint);
  focusRef.current = focusMint;
  const clockRef = useRef<number | undefined>(worldTime);
  clockRef.current = worldTime;
  const skyRef = useRef<WorldSky | null>(null);
  const islandRef = useRef<Island | null>(null);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;
  const allowanceRef = useRef(propAllowance);
  allowanceRef.current = propAllowance;
  const doneRef = useRef(onActionComplete);
  doneRef.current = onActionComplete;

  // The parent hands over a fresh array every tick; only a real change in who is owned matters.
  const ownedKey = creatures.map((c) => c.mint).join("|");
  const owned = useMemo(() => (ownedKey ? ownedKey.split("|") : []), [ownedKey]);
  const [layout, setLayoutState] = useState<WorldLayout>(() =>
    reconcile(initialLayout ?? defaultLayout(creatures.map((c) => c.mint), spec), creatures.map((c) => c.mint)),
  );
  const layoutRef = useRef(layout);
  const setLayout = useCallback((next: WorldLayout) => {
    layoutRef.current = next;
    setLayoutState(next);
  }, []);

  // The layout lives in the wallet's profile: it is written when editing ends, not on every tap.
  const commitRef = useRef(onCommitLayout);
  commitRef.current = onCommitLayout;
  const baselineRef = useRef("");
  /** Objects saved in the wallet that the wallet no longer backs: hidden, but kept when saving. */
  const hiddenRef = useRef<PlacedProp[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const commit = useCallback(async () => {
    const current = layoutRef.current;
    if (JSON.stringify(current) === baselineRef.current) return;
    const toSave: WorldLayout = { ...current, props: [...(current.props ?? []), ...hiddenRef.current].slice(0, MAX_PROPS) };
    setSaving(true);
    setSaveError("");
    try {
      await commitRef.current(toSave);
      baselineRef.current = JSON.stringify(current);
    } catch (e) {
      setSaveError(e instanceof Error && /reject|cancel|denied/i.test(e.message) ? "Not saved: signature cancelled" : "Couldn't save your habitat. Try Edit → Done again.");
    } finally {
      setSaving(false);
    }
  }, []);

  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"rebyters" | "objects">("rebyters");
  const [armed, setArmed] = useState<AssetKey | null>(null);
  const [selection, setSelectionState] = useState<Selection>(null);
  const [notice, setNotice] = useState("");
  const [glance, setGlance] = useState("");
  const [propCount, setPropCount] = useState(0);
  const editingRef = useRef(false);
  const armedRef = useRef<AssetKey | null>(null);
  const selectionRef = useRef<Selection>(null);
  editingRef.current = editing;
  armedRef.current = armed;
  const setSelection = (next: Selection) => {
    selectionRef.current = next;
    setSelectionState(next);
  };
  const say = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? "" : current)), 2600);
  }, []);

  // ---- The scene -----------------------------------------------------------------

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    let dead = false;
    let world: HabitatWorld;
    try {
      world = new HabitatWorld(host, canvas, { onNotice: (message) => say(NOTICES[message] ?? "That spot is not available."), ownSky: true, ownBase: true });
    } catch {
      return;
    }
    worldRef.current = world;
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 300);
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const head = new THREE.Vector3();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 40),
      new THREE.MeshBasicMaterial({ color: 0xe3b341, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.95, fog: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 9;
    ring.visible = false;
    world.scene.add(ring);
    let shadowClock = 0;
    let lastAspect = 0;
    let rig: WorldRig | null = null;

    const spots = () =>
      walkers.current.map((w) => {
        const p = walkerPosition(w);
        return { x: OX + p.x, z: OZ + p.z };
      });
    const rand = Math.random;
    const standable = (i: number, j: number) => world.canStand(i, j) && i >= BOARD.i0 && i <= BOARD.i1 && j >= BOARD.j0 && j <= BOARD.j1;

    const update = (dt: number) => {
      if (!rig) return;
      const w = host.clientWidth,
        h = host.clientHeight;
      const aspect = w && h ? w / h : 1;
      if (aspect !== lastAspect) {
        lastAspect = aspect;
        rig.setAspect(aspect);
      }
      let moving = false;
      const calm = editingRef.current;
      for (const walker of walkers.current) {
        const starring = walker.id === focusRef.current;
        if ((!calm && !starring) || walker.walking) stepWalker(walker, walkers.current, dt, { canStand: standable, rand, speed: 0.45 });
        const entity = entities.current.get(walker.id);
        if (!entity) continue;
        const p = walkerPosition(walker);
        const x = OX + p.x,
          z = OZ + p.z;
        entity.outer.position.set(x, world.map.heightAt(x, z), z);
        entity.outer.visible = true;
        if (walker.walking) moving = true;
        if (starring) rig.trackFocus({ x, z }, entity.height);
        if (entity.billboard) entity.yaw = rig.cur.yaw;
        else entity.yaw += angleDelta(entity.yaw, starring && !walker.walking ? rig.cur.yaw : walker.yaw) * Math.min(1, dt * 7);
        entity.outer.rotation.y = entity.yaw;
        blendWalk(entity, walker.walking, dt);
        entity.mixer?.update(dt);
      }
      shadowClock += dt;
      if ((moving || calm) && shadowClock > 0.07) {
        shadowClock = 0;
        world.markShadowsDirty();
      }
      rig.update(dt);
      rig.apply(camera);
      const clock = clockRef.current ?? Date.now();
      world.clockMs = clock;
      skyRef.current?.update(dt, camera, clock);
      islandRef.current?.update(performance.now() / 1000);
      // The selection ring follows what is selected.
      const sel = selectionRef.current;
      if (sel && editingRef.current) {
        const at =
          sel.kind === "prop"
            ? { x: sel.entry.x, z: sel.entry.z }
            : (() => {
                const walker = walkers.current.find((k) => k.id === sel.mint);
                if (!walker) return null;
                const p = walkerPosition(walker);
                return { x: OX + p.x, z: OZ + p.z };
              })();
        ring.visible = !!at;
        if (at) ring.position.set(at.x, world.groundY + 0.06, at.z);
      } else ring.visible = false;
      // Speech bubbles ride above each head.
      for (const [mint, el] of emoteRefs.current) {
        const entity = entities.current.get(mint);
        if (!entity || !entity.outer.visible) {
          el.style.visibility = "hidden";
          continue;
        }
        head.set(entity.outer.position.x, entity.outer.position.y + entity.height + 0.1, entity.outer.position.z).project(camera);
        const behind = head.z > 1;
        el.style.transform = `translate(${((head.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((0.5 - head.y * 0.5) * h).toFixed(1)}px)`;
        el.style.visibility = behind || el.dataset.show !== "true" ? "hidden" : "visible";
      }
    };
    world.setExternal({ camera, update });

    (async () => {
      const layoutNow = layoutRef.current;
      try {
        await world.init({ kind: "diorama", size, data: { ...HabitatWorld.blank(size, period), props: [] } });
        world.setCarpetVisible(false);
        world.setGrid(false);
        islandRef.current = createIsland(world.scene, world.centre, size / 5);
        world.clockMs = clockRef.current ?? Date.now();
        skyRef.current = createSky(world.scene, world.centre, period);
      } catch {
        return;
      }
      if (dead) return;
      // The editor's own creature is not part of this world: park it off the board.
      world.creature = { x: OX + 60, z: OZ + 60 };
      rig = new WorldRig(world.centre, 2.9 * (size / 5), spots);
      rigRef.current = rig;
      rig.intro();
      if (layoutNow.props) {
        // Only what the wallet holds is shown; the rest stays saved but hidden.
        const { shown, hidden } = limitProps(layoutNow.props, (key) => allowanceRef.current?.(key) ?? Number.POSITIVE_INFINITY);
        hiddenRef.current = hidden;
        await world.restore({ ...world.snapshot(), props: shown.map((p, n) => ({ id: n + 1, ...p })) });
      } else {
        await world.addProp("tree", tileX(TREE_TILE.i), tileZ(TREE_TILE.j));
      }
      if (dead) return;
      setPropCount(world.entries.length);
      baselineRef.current = JSON.stringify(layoutRef.current);
      setReady(true);
    })();

    // ---- Pointer: orbit, pinch, wheel, tap ------------------------------------------

    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let downAt = 0;
    let pinch = 0;
    const local = (event: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top, w: rect.width, h: rect.height };
    };
    const aim = (x: number, y: number, w: number, h: number) => {
      ndc.set((x / w) * 2 - 1, -((y / h) * 2 - 1));
      raycaster.setFromCamera(ndc, camera);
    };
    const pickRebyter = (x: number, y: number, w: number, h: number) => {
      aim(x, y, w, h);
      let best: { mint: string; d: number } | null = null;
      for (const [mint, entity] of entities.current) {
        if (!entity.outer.visible) continue;
        const hit = raycaster.intersectObject(entity.outer, true)[0];
        if (hit && (!best || hit.distance < best.d)) best = { mint, d: hit.distance };
      }
      if (best) return best.mint;
      // Fingers are not precise: take the nearest rebyter within reach of the tap.
      let near: { mint: string; d: number } | null = null;
      for (const [mint, entity] of entities.current) {
        if (!entity.outer.visible) continue;
        head.set(entity.outer.position.x, entity.outer.position.y + entity.height * 0.5, entity.outer.position.z).project(camera);
        const d = Math.hypot((head.x * 0.5 + 0.5) * w - x, (0.5 - head.y * 0.5) * h - y);
        if (d < 46 && (!near || d < near.d)) near = { mint, d };
      }
      return near?.mint ?? null;
    };
    const tileUnder = (x: number, y: number, w: number, h: number) => {
      aim(x, y, w, h);
      const { origin, direction } = raycaster.ray;
      if (Math.abs(direction.y) < 1e-4) return null;
      const t = (world.groundY - origin.y) / direction.y;
      if (t <= 0) return null;
      const i = Math.round(origin.x + direction.x * t - OX),
        j = Math.round(origin.z + direction.z * t - OZ);
      return i >= BOARD.i0 && i <= BOARD.i1 && j >= BOARD.j0 && j <= BOARD.j1 ? { i, j } : null;
    };
    const propAt = (i: number, j: number) =>
      world.entries.find((e) => footprint(e.key, e.x, e.z, e.r).some(([ti, tj]) => ti === i && tj === j));
    const walkerAt = (i: number, j: number) => walkers.current.find((k) => (k.i === i && k.j === j) || (k.ti === i && k.tj === j));

    const COVER_FREE = (entry: PropEntry) => ["grass", "wildflowers", "mushrooms"].includes(entry.key);
    const persistNow = () => {
      const placed = walkers.current.map((k) => ({ mint: k.id, i: k.ti, j: k.tj }));
      setLayout({
        v: 1,
        placed,
        props: world.entries.map(({ key, x, z, h, r }) => ({ key, x, z, h, r })),
      });
      setPropCount(world.entries.length);
    };
    persistRef.current = persistNow;
    // Wide objects must stay on the board and off the rebyters.
    world.tileFilter = (i, j) => i >= BOARD.i0 && i <= BOARD.i1 && j >= BOARD.j0 && j <= BOARD.j1 && !walkerAt(i, j);
    // Fine adjustments for the selected object: turn it, or slide it inside its tile.
    const dir = new THREE.Vector3();
    editRef.current = {
      resize: (factor) => {
        const sel = selectionRef.current;
        if (sel?.kind !== "prop") return;
        world.updateProp(sel.entry, { h: Math.min(14, Math.max(0.15, sel.entry.h * factor)) });
        persistNow();
      },
      rotate: (delta) => {
        const sel = selectionRef.current;
        if (sel?.kind !== "prop") return;
        if (world.rotateProp(sel.entry, delta)) persistNow();
      },
      nudge: (right, forward) => {
        const sel = selectionRef.current;
        if (sel?.kind !== "prop") return;
        // "Up" and "right" follow the screen, whichever way the camera is turned.
        camera.getWorldDirection(dir);
        dir.y = 0;
        if (dir.lengthSq() < 1e-6) return;
        dir.normalize();
        const step = 0.2;
        world.nudgeProp(
          sel.entry,
          (-dir.z * right + dir.x * forward) * step,
          (dir.x * right + dir.z * forward) * step,
        );
        persistNow();
      },
    };

    const tapEdit = async (x: number, y: number, w: number, h: number) => {
      const tile = tileUnder(x, y, w, h);
      if (!tile) {
        setSelection(null);
        return;
      }
      const walker = walkerAt(tile.i, tile.j);
      const prop = propAt(tile.i, tile.j);
      const selected = selectionRef.current;
      // Something is selected and this tile is free: move it here.
      if (selected && !walker && !(selected.kind === "prop" && prop === selected.entry)) {
        if (selected.kind === "creature") {
          const mine = walkers.current.find((k) => k.id === selected.mint);
          if (mine && standable(tile.i, tile.j) && !tileTaken(walkers.current, tile.i, tile.j, mine.id)) {
            placeWalker(mine, tile.i, tile.j);
            persistNow();
            return;
          }
          say(prop ? "There is an object on that tile." : "It can't stand there.");
          return;
        }
        if (!prop || COVER_FREE(prop)) {
          if (world.moveProp(selected.entry, tileX(tile.i), tileZ(tile.j))) persistNow();
          return;
        }
      }
      if (walker) {
        setSelection({ kind: "creature", mint: walker.id });
        setArmed(null);
        return;
      }
      if (prop) {
        setSelection({ kind: "prop", entry: prop });
        setArmed(null);
        return;
      }
      const key = armedRef.current;
      if (key) {
        if (world.entries.length >= MAX_PROPS) {
          say(`The habitat holds up to ${MAX_PROPS} objects.`);
          return;
        }
        if (tileTaken(walkers.current, tile.i, tile.j)) {
          say("A rebyter is standing there.");
          return;
        }
        const allowed = allowanceRef.current?.(key) ?? Number.POSITIVE_INFINITY;
        if (world.entries.filter((e) => e.key === key).length >= allowed) {
          say(allowed === 0 ? `You don't own a ${labelOf(key).toLowerCase()} yet. Get one in the store.` : `You've placed every ${labelOf(key).toLowerCase()} you own.`);
          return;
        }
        const facing = FRONT_FACING.includes(key)
          ? facingInward(
              tileX(tile.i),
              tileZ(tile.j),
              tileX((BOARD.i0 + BOARD.i1) / 2),
              tileZ((BOARD.j0 + BOARD.j1) / 2),
            )
          : undefined;
        const added = await world.addProp(key, tileX(tile.i), tileZ(tile.j), facing);
        if (added) persistNow();
        return;
      }
      setSelection(null);
    };

    const tap = (x: number, y: number, w: number, h: number) => {
      rigRef.current?.poke();
      if (editingRef.current) {
        void tapEdit(x, y, w, h);
        return;
      }
      const mint = pickRebyter(x, y, w, h);
      if (!mint) return;
      if (mint === focusRef.current && exitRef.current) exitRef.current();
      else onSelectRef.current(mint);
    };

    const down = (event: PointerEvent) => {
      canvas.setPointerCapture?.(event.pointerId);
      const p = local(event);
      pointers.set(event.pointerId, { x: p.x, y: p.y });
      if (pointers.size === 1) {
        moved = 0;
        downAt = performance.now();
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
        moved = 999;
      }
    };
    const move = (event: PointerEvent) => {
      const before = pointers.get(event.pointerId);
      if (!before) return;
      const p = local(event);
      const dx = p.x - before.x,
        dy = p.y - before.y;
      pointers.set(event.pointerId, { x: p.x, y: p.y });
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) rigRef.current?.zoom(pinch / d);
        pinch = d;
        return;
      }
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > TAP_PIXELS && !editingRef.current) rigRef.current?.orbit(-dx * 0.006, dy * 0.0045);
    };
    const up = (event: PointerEvent) => {
      const had = pointers.has(event.pointerId);
      const p = local(event);
      pointers.delete(event.pointerId);
      if (had && pointers.size === 0 && moved <= TAP_PIXELS && performance.now() - downAt < 600) tap(p.x, p.y, p.w, p.h);
    };
    const cancel = (event: PointerEvent) => pointers.delete(event.pointerId);
    const wheel = (event: WheelEvent) => {
      if (editingRef.current) return;
      event.preventDefault();
      rigRef.current?.zoom(Math.exp(event.deltaY * 0.0012));
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", cancel);
    canvas.addEventListener("wheel", wheel, { passive: false });

    const entityMap = entities.current;
    const assetMap = assets.current;
    return () => {
      dead = true;
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancel);
      canvas.removeEventListener("wheel", wheel);
      for (const entity of entityMap.values()) {
        entity.mixer?.stopAllAction();
        disposeObject(entity.outer, false);
      }
      islandRef.current?.dispose();
      islandRef.current = null;
      skyRef.current?.dispose();
      skyRef.current = null;
      entityMap.clear();
      walkers.current = [];
      for (const asset of loadedAssets.current) disposeAsset(asset);
      loadedAssets.current = [];
      assetMap.clear();
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
      world.dispose();
      world.renderer.forceContextLoss();
      worldRef.current = null;
      rigRef.current = null;
    };
    // The scene is built once; the period, layout and creatures are followed by the effects below.
  }, []);

  // Day and night follow the world clock.
  useEffect(() => {
    if (ready) skyRef.current?.setPeriod(period);
    void worldRef.current?.setPeriod(period).then(() => setPropCount(worldRef.current?.entries.length ?? 0));
  }, [period, ready]);

  // ---- Rebyters follow the layout -----------------------------------------------------

  const assetFor = useCallback((evolution: Evolution) => {
    let promise = assets.current.get(evolution.id);
    if (!promise) {
      promise = loadEvolutionAsset(evolution).then((asset) => {
        loadedAssets.current.push(asset);
        return asset;
      });
      assets.current.set(evolution.id, promise);
    }
    return promise;
  }, []);

  useEffect(() => {
    const world = worldRef.current;
    if (!ready || !world) return;
    const wanted = layout.placed;
    // Take out the ones that left.
    for (const mint of [...entities.current.keys()]) {
      if (wanted.some((p) => p.mint === mint)) continue;
      const entity = entities.current.get(mint)!;
      entity.mixer?.stopAllAction();
      world.scene.remove(entity.outer);
      disposeObject(entity.outer, false);
      entities.current.delete(mint);
    }
    walkers.current = walkers.current.filter((k) => wanted.some((p) => p.mint === k.id));
    // Bring in the ones that arrived.
    for (const p of wanted) {
      if (walkers.current.some((k) => k.id === p.mint)) continue;
      const creature = creatures.find((c) => c.mint === p.mint);
      if (!creature) continue;
      walkers.current.push(createWalker(p.mint, p.i, p.j));
      void assetFor(creature.evolution)
        .then((asset) => {
          if (!walkers.current.some((k) => k.id === p.mint) || entities.current.has(p.mint) || !worldRef.current) return;
          const entity = buildEntity(p.mint, asset);
          entities.current.set(p.mint, entity);
          worldRef.current.scene.add(entity.outer);
          worldRef.current.markShadowsDirty();
        })
        .catch(() => undefined);
    }
  }, [layout, ready, creatures, assetFor]);

  // The collection changed: drop what is gone, and show a newly minted rebyter right away.
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    const current = layoutRef.current;
    const cleaned = reconcile(current, owned);
    let next = cleaned;
    const fresh = known.current ? owned.filter((m) => !known.current!.has(m)) : [];
    known.current = new Set(owned);
    for (const mint of fresh) {
      const world = worldRef.current;
      const taken = next.placed.map((p) => ({ i: p.i, j: p.j }));
      const tile = freeTile(taken, (i, j) => !world || !world.canStand(i, j), spec);
      const dropFirst = next.placed.length >= MAX_PLACED;
      const base = dropFirst ? next.placed.slice(1) : next.placed;
      if (tile) next = { ...next, placed: [...base, { mint, ...tile }] };
    }
    if (!next.placed.length && owned.length) next = { ...next, placed: defaultLayout(owned, spec).placed };
    if (next !== current && JSON.stringify(next) !== JSON.stringify(current)) setLayout(next);
  }, [owned, setLayout]);

  // ---- Speech bubbles ------------------------------------------------------------------

  const happyKey = creatures.filter((c) => c.happy && !c.emote).map((c) => c.mint).join("|");

  useEffect(() => {
    const happy = creaturesRef.current.filter((c) => c.happy && !c.emote && layout.placed.some((p) => p.mint === c.mint));
    if (!happy.length) {
      setGlance("");
      return;
    }
    let n = 0;
    let hide = 0;
    const show = () => {
      setGlance(happy[n % happy.length].mint);
      n++;
      window.clearTimeout(hide);
      hide = window.setTimeout(() => setGlance(""), 4000);
    };
    const first = window.setTimeout(show, 3000);
    const timer = window.setInterval(show, 16000);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(hide);
      window.clearInterval(timer);
      setGlance("");
    };
  }, [happyKey, layout]);

  // ---- Edit mode -------------------------------------------------------------------------

  useEffect(() => {
    const rig = rigRef.current;
    if (!rig) return;
    worldRef.current?.setGrid(editing);
    if (!focusRef.current) rig.setMode(editing ? "top" : "free");
    if (!editing) {
      setArmed(null);
      setSelection(null);
    }
  }, [editing, ready]);

  // ---- Protagonist ---------------------------------------------------------------------------

  const focusedBefore = useRef<string | null>(null);
  useEffect(() => {
    const rig = rigRef.current;
    if (!rig || !ready) return;
    if (focusMint) {
      if (editingRef.current) {
        persistRef.current();
        setEditing(false);
        void commit();
      }
      const current = layoutRef.current;
      if (!current.placed.some((p) => p.mint === focusMint) && owned.includes(focusMint)) {
        const world = worldRef.current;
        const tile = freeTile(
          current.placed.map((p) => ({ i: p.i, j: p.j })),
          (i, j) => !world || !world.canStand(i, j),
          spec,
        );
        const base = current.placed.length >= MAX_PLACED ? current.placed.slice(1) : current.placed;
        if (tile) setLayout({ ...current, placed: [...base, { mint: focusMint, ...tile }] });
      }
      const walker = walkers.current.find((k) => k.id === focusMint);
      const entity = entities.current.get(focusMint);
      const p = walker ? walkerPosition(walker) : null;
      rig.setFocus(true, p ? { x: OX + p.x, z: OZ + p.z } : undefined, entity?.height ?? 0.9);
    } else if (focusedBefore.current) {
      rig.setFocus(false);
    }
    focusedBefore.current = focusMint;
  }, [focusMint, ready, owned, setLayout, commit]);

  // What the protagonist is doing: care animations play on the rebyter in the world.
  useEffect(() => {
    if (!ready || !focusMint) return;
    const entity = entities.current.get(focusMint);
    if (!entity) return;
    if (action === "idle") {
      stopAction(entity);
      return;
    }
    const played = playAction(entity, action, () => doneRef.current?.());
    if (!played) doneRef.current?.();
    return () => {
      if (action === "sad") stopAction(entity);
    };
  }, [action, ready, focusMint, layout]);

  const finishEditing = () => {
    persistRef.current();
    setEditing(false);
    void commit();
  };
  const togglePlaced = (mint: string) => {
    const current = layoutRef.current;
    const world = worldRef.current;
    if (current.placed.some((p) => p.mint === mint)) {
      if (current.placed.length <= 1) {
        say("Keep at least one rebyter in the world.");
        return;
      }
      setLayout({ ...current, placed: current.placed.filter((p) => p.mint !== mint) });
      if (selectionRef.current?.kind === "creature" && selectionRef.current.mint === mint) setSelection(null);
      return;
    }
    if (current.placed.length >= MAX_PLACED) {
      say(`The world holds ${MAX_PLACED} rebyters. Take one out first.`);
      return;
    }
    const tile = freeTile(
      walkers.current.map((k) => ({ i: k.ti, j: k.tj })),
      (i, j) => !world || !world.canStand(i, j),
      spec,
    );
    if (!tile) {
      say("There is no free tile.");
      return;
    }
    setLayout({ ...current, placed: [...current.placed, { mint, ...tile }] });
  };
  const removeSelection = () => {
    const world = worldRef.current;
    const selected = selectionRef.current;
    if (!world || !selected) return;
    if (selected.kind === "prop") {
      world.removeProp(selected.entry);
      persistRef.current();
    } else togglePlaced(selected.mint);
    setSelection(null);
  };

  const nameOf = (mint: string) => creatures.find((c) => c.mint === mint)?.evolution.name ?? "Rebyter";
  const placedMints = new Set(layout.placed.map((p) => p.mint));

  return (
    <div className="world-view" ref={hostRef} data-ready={ready} data-editing={editing}>
      <canvas ref={canvasRef} className="world-canvas" />
      {!ready && (
        <div className="world-loading" role="status">
          Loading your world…
        </div>
      )}

      {creatures
        .filter((c) => placedMints.has(c.mint))
        .map((c) => {
          const emote: Emote | null = c.emote ?? (glance === c.mint ? "love" : null);
          const show = !!emote && !editing;
          const def = emote ? EMOTES[emote] : null;
          return (
            <div
              key={c.mint}
              ref={(el) => {
                if (el) emoteRefs.current.set(c.mint, el);
                else emoteRefs.current.delete(c.mint);
              }}
              className="world-emote"
              data-show={show}
              style={{ visibility: "hidden" }}
            >
              {def && (
                <div className={`world-emote-bubble gl-panel${def.need ? " needs-attention" : ""}`} role="status" aria-label={`${c.evolution.name}: ${def.label}`}>
                  {def.Icon ? <def.Icon aria-hidden="true" /> : <b aria-hidden="true">{def.text}</b>}
                </div>
              )}
            </div>
          );
        })}

      {/* Keyboard and screen readers get a button for every rebyter in the world. */}
      <div className="world-sr">
        {creatures
          .filter((c) => placedMints.has(c.mint))
          .map((c) => (
            <button key={c.mint} onClick={() => onSelect(c.mint)}>
              Open {c.evolution.name}
            </button>
          ))}
      </div>

      {(saving || saveError) && (
        <div className="world-saving gl-panel" role="status">
          {saving ? "Saving to your wallet…" : saveError}
        </div>
      )}

      {ready && !editing && !focusMint && (
        <button className="world-edit-button gl-panel" onClick={() => setEditing(true)} aria-label="Edit habitat">
          <Pencil />
          <span>Edit</span>
        </button>
      )}

      {editing && (
        <section className="world-edit gl-panel" aria-label="Edit habitat">
          <div className="world-edit-head">
            <strong>Edit habitat</strong>
            <span className="world-edit-count">
              {layout.placed.length}/{MAX_PLACED} rebyters · {propCount}/{MAX_PROPS} objects
            </span>
            <button className="ui-btn ui-btn-primary world-done" onClick={finishEditing}>
              <Check /> Done
            </button>
          </div>
          <div className="world-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "rebyters"} onClick={() => setTab("rebyters")}>
              Rebyters
            </button>
            <button role="tab" aria-selected={tab === "objects"} onClick={() => setTab("objects")}>
              Objects
            </button>
          </div>
          {tab === "rebyters" ? (
            <div className="world-chips">
              {creatures.map((c) => (
                <button
                  key={c.mint}
                  className="world-chip"
                  data-on={placedMints.has(c.mint)}
                  onClick={() => togglePlaced(c.mint)}
                  aria-pressed={placedMints.has(c.mint)}
                >
                  <span className="world-chip-art">
                    <CreatureSprite evolution={c.evolution} />
                  </span>
                  <span>{c.evolution.name}</span>
                  <small>{placedMints.has(c.mint) ? "In the world" : "In the vault"}</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="world-chips">
              {PALETTE_ITEMS.map((item) => {
                const allowed = propAllowance?.(item.key) ?? Number.POSITIVE_INFINITY;
                const used = worldRef.current?.entries.filter((e) => e.key === item.key).length ?? 0;
                const spent = allowed !== Number.POSITIVE_INFINITY && used >= allowed;
                return (
                <button
                  key={item.key}
                  className="world-chip world-chip-object"
                  data-spent={spent}
                  data-on={armed === item.key}
                  onClick={() => {
                    setArmed(armed === item.key ? null : item.key);
                    setSelection(null);
                  }}
                  aria-pressed={armed === item.key}
                >
                  <span>{item.label}</span>
                  {allowed !== Number.POSITIVE_INFINITY && <small>{used}/{allowed}</small>}
                </button>
                );
              })}
            </div>
          )}
          <div className="world-edit-foot" role="status">
            {notice ? (
              <span className="world-notice">{notice}</span>
            ) : selection ? (
              <>
                <span>
                  {selection.kind === "creature"
                    ? nameOf(selection.mint)
                    : labelOf(selection.entry.key)}{" "}
                  · tap a tile to move it
                </span>
                {selection.kind === "prop" && (
                  <span className="world-adjust" role="group" aria-label="Adjust object">
                    <button onClick={() => editRef.current?.resize(1 / 1.12)} aria-label="Smaller"><Minus /></button>
                    <button onClick={() => editRef.current?.resize(1.12)} aria-label="Bigger"><Plus /></button>
                    <button onClick={() => editRef.current?.rotate(-Math.PI / 12)} aria-label="Turn left"><RotateCcw /></button>
                    <button onClick={() => editRef.current?.rotate(Math.PI / 12)} aria-label="Turn right"><RotateCw /></button>
                    {spanOf(selection.entry.key) === 1 && (
                      <>
                        <button onClick={() => editRef.current?.nudge(-1, 0)} aria-label="Move left"><ArrowLeft /></button>
                        <button onClick={() => editRef.current?.nudge(0, 1)} aria-label="Move up"><ArrowUp /></button>
                        <button onClick={() => editRef.current?.nudge(0, -1)} aria-label="Move down"><ArrowDown /></button>
                        <button onClick={() => editRef.current?.nudge(1, 0)} aria-label="Move right"><ArrowRight /></button>
                      </>
                    )}
                  </span>
                )}
                <button className="ui-btn ui-btn-secondary world-remove" onClick={removeSelection}>
                  {selection.kind === "creature" ? <X /> : <Trash2 />}
                  {selection.kind === "creature" ? "Send to vault" : "Remove"}
                </button>
              </>
            ) : armed ? (
              <span>Tap a free tile to place it.</span>
            ) : (
              <span>Tap a rebyter or an object to move it, or pick something to add.</span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
