import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import {
  meadow,
  type AssetKey,
  type PlacedProp,
} from "../../assets/meadow";
import {
  configureHabitatRenderer,
  configureHabitatShadow,
} from "../../assets/habitat-lighting";
import { CLIFF_LEVEL } from "./grid";
import { meadowTexture } from "../../assets/habitat-materials";
import type { WorldPeriod } from "../../../hooks/useWorldClock";
import type { AssetModel } from "../../../lib/assets/rig";
import {
  BANK_Y,
  BASE_DEPTH,
  GX,
  GZ,
  MAX_LEVEL,
  OX,
  OZ,
  SUB,
  TileMap,
  WATER_Y,
  buildContourGeometry,
  buildGridGeometry,
  buildOverlayGeometry,
  type Ground,
  type Region,
  type TileData,
} from "./tiles";

export type ViewId = "pano" | "mobile" | "top";
export type ViewMode = ViewId | "triple";
export type Pane = { id: ViewId; x: number; y: number; w: number; h: number };
export type PropData = { key: AssetKey; x: number; z: number; h: number; r: number };
export type PropEntry = PropData & {
  id: number;
  baseH: number;
  prop: PlacedProp | null;
};
export type DioramaSize = 5 | 7 | 9 | 10 | 15;
export const DIORAMA_SIZES: DioramaSize[] = [5, 10, 15];
export type Kind = "diorama" | "preview";
export type Target = { kind: "preview" } | { kind: "diorama"; size: DioramaSize; data?: SceneData | null };
export type SceneData = {
  version: 2;
  kind: "diorama";
  size: DioramaSize;
  period: WorldPeriod;
  tiles: TileData;
  props: (PropData & { id: number })[];
  creature: { x: number; z: number };
  lighting?: Lighting;
};

/** Easy lighting controls. 1 = the game's own value for the current period. */
export type Lighting = {
  sun: number; // key light intensity multiplier
  ambient: number; // sky fill multiplier
  rim: number; // back / rim light multiplier
  exposure: number; // overall brightness
  warmth: number; // -1 cool … +1 warm
  azimuth: number; // degrees the sun is turned around the scene
  elevation: number; // degrees the sun is raised (+) or lowered (-)
  shadows: boolean;
};
export const DEFAULT_LIGHTING: Lighting = {
  sun: 1,
  ambient: 1,
  rim: 1,
  exposure: 1,
  warmth: 0,
  azimuth: 0,
  elevation: 0,
  shadows: true,
};

/** Props from the game's own environment folder, with a sensible default height in metres. */
export const PROP_CATALOG: { key: AssetKey; label: string; h: number }[] = [
  { key: "tree", label: "Árbol", h: 5.5 },
  { key: "pine", label: "Pino", h: 5.5 },
  { key: "hero", label: "Árbol grande", h: 6.5 },
  { key: "bush", label: "Arbusto con bayas", h: 1.1 },
  { key: "rocks", label: "Rocas con musgo", h: 0.6 },
  { key: "shoreRocks", label: "Rocas de orilla", h: 0.55 },
  { key: "stump", label: "Tocón", h: 0.65 },
  { key: "log", label: "Tronco hueco", h: 0.65 },
  { key: "mushrooms", label: "Hongos", h: 0.28 },
  { key: "grass", label: "Pasto alto", h: 0.7 },
  { key: "wildflowers", label: "Flores silvestres", h: 0.5 },
  { key: "reeds", label: "Juncos", h: 1.1 },
  { key: "lantern", label: "Farol encantado", h: 1 },
  { key: "vending", label: "Máquina expendedora", h: 4.6 },
  { key: "busStop", label: "Parada de colectivo", h: 5 },
  { key: "punchingBag", label: "Saco de boxeo", h: 3 },
];

/** Props with a clear front (the model faces +z at rotation 0): placed facing the middle, not at random. */
export const FRONT_FACING: AssetKey[] = ["vending", "busStop", "punchingBag"];
/** Rotation (snapped to quarter turns) that makes a front-facing prop look at (cx, cz) from (x, z). */
export function facingInward(x: number, z: number, cx: number, cz: number) {
  const angle = Math.atan2(cx - x, cz - z);
  return Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
}

/** Tiles a prop covers along its own width (default 1). Wider props are quarter-turn only. */
export const PROP_SPAN: Partial<Record<AssetKey, number>> = { busStop: 2 };
export const spanOf = (key: AssetKey) => PROP_SPAN[key] ?? 1;
/** Direction of the prop's width on the grid, for a quarter-turn rotation. */
const axisOf = (r: number) => ({ x: Math.round(Math.cos(r)), z: Math.round(-Math.sin(r)) });
/** Every tile a prop stands on. Two-tile props are centred between their tiles. */
export function footprint(key: AssetKey, x: number, z: number, r: number): [number, number][] {
  if (spanOf(key) === 1) {
    const t = TileMap.tileOf(x, z);
    return [[t.i, t.j]];
  }
  const a = axisOf(r);
  const t0 = TileMap.tileOf(x - 0.5 * a.x, z - 0.5 * a.z);
  const t1 = TileMap.tileOf(x + 0.5 * a.x, z + 0.5 * a.z);
  return [
    [t0.i, t0.j],
    [t1.i, t1.j],
  ];
}
/** Centre of a prop whose first tile is (i, j); `side` picks which way its width runs. */
export function spanCenter(key: AssetKey, i: number, j: number, r: number, side = 1) {
  if (spanOf(key) === 1) return { x: OX + i, z: OZ + j };
  const a = axisOf(r);
  return { x: OX + i + 0.5 * a.x * side, z: OZ + j + 0.5 * a.z * side };
}

export const CREATURE_Z = -2.97; // same depth the game uses for the companion
const CREATURE_SCALE = 0.9;
const FOV = 35;
const FAKE_HOUR: Record<WorldPeriod, number> = {
  Night: 2,
  Morning: 9,
  Day: 15,
  Evening: 19.3,
};
const fakeUnix = (period: WorldPeriod) =>
  Date.UTC(
    2026,
    0,
    1,
    Math.floor(FAKE_HOUR[period]),
    Math.round((FAKE_HOUR[period] % 1) * 60),
  );

const clipNames = ["idle", "idleblinking"];
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

type ViewState = {
  id: ViewId;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  yaw: number;
  pitch: number;
  dist: number;
  zoom: number;
  target: THREE.Vector3;
  custom: boolean;
};

/** Ground cover can share a tile with other props; everything else is solid. */
export const COVER: AssetKey[] = ["grass", "wildflowers", "mushrooms"];
/** Props that belong in or at the edge of water. */
const WATER_PROPS: AssetKey[] = ["reeds", "shoreRocks"];
const MAX_COVER = 500;

type Callbacks = {
  onNotice?: (message: string) => void;
  onLayout?: (panes: Pane[]) => void;
  onError?: (message: string) => void;
  /** The caller draws its own sun, moon, stars and clouds, and wants a steeper sky gradient. */
  ownSky?: boolean;
  /** The caller draws the ground's base (an island, say) instead of the square earth block. */
  ownBase?: boolean;
};

export class HabitatWorld {
  readonly map = new TileMap();
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  period: WorldPeriod = "Evening";
  mode: ViewMode = "triple";
  activeView: ViewId = "pano";
  panes: Pane[] = [];
  entries: PropEntry[] = [];
  selected: PropEntry | null = null;
  creature = { x: 0, z: CREATURE_Z };
  kind: Kind = "diorama";
  size: DioramaSize = 5;
  creatureSelected = false;
  /** Fixed cameras exactly as the player sees the game; orbit, pan and zoom are off. */
  playerView = false;
  /**
   * A host that draws the scene itself (the game's world view). While set, the
   * editor's panes are replaced by one full-canvas render with the host's camera,
   * and the editor's own creature, blob shadow and rim light are switched off.
   */
  private external: { camera: THREE.Camera; update: (dt: number, now: number) => void } | null = null;
  private creatureExtent = 1.8; // metres: the creature's longest side
  showGrid = true;
  lighting: Lighting = { ...DEFAULT_LIGHTING };
  private baseExposure = 1;

  private env!: ReturnType<typeof meadow>;
  private readonly host: HTMLElement;
  private readonly callbacks: Callbacks;
  private readonly mobile: boolean;
  private nextId = 1;
  private disposed = false;
  private raf = 0;
  private lastFrame = performance.now();
  private readonly views: Record<ViewId, ViewState>;
  private creatureSpan = 1.4;
  private creatureModel: AssetModel | null = null;
  private creatureClip: THREE.AnimationClip | null = null;
  private baseTop: THREE.Mesh | null = null;
  private baseSides: THREE.Mesh | null = null;
  private generation = 0;
  private restY = 0; // height the creature is easing towards

  // Lights, same rig as the game's landscape scene.
  private readonly ambient = new THREE.HemisphereLight(0xd9efff, 0x3b5c42, 2.3);
  private readonly key = new THREE.DirectionalLight(0xffffff, 2.5);
  private readonly fill = new THREE.DirectionalLight(0xffefd9, 0.45);
  private readonly moon = new THREE.DirectionalLight(0xcfe2ff, 0);
  private readonly rim = new THREE.DirectionalLight(0x88dbff, 0);
  private readonly companionRim = new THREE.SpotLight(0xd8f2ff, 0.52, 4.8, Math.PI / 5, 0.7, 2);
  private readonly companionRimTarget = new THREE.Object3D();

  // Editing layers on top of the meadow.
  private readonly overlay: THREE.Mesh;
  private lakeMesh: THREE.Mesh | null = null;
  private bankMesh: THREE.Mesh | null = null;
  private readonly gridLines: THREE.LineSegments;
  private readonly cursor: THREE.Mesh;
  private readonly cursorPos = new Float32Array(25 * 25 * 3);
  private readonly ring: THREE.Mesh;
  private instanced: { mesh: THREE.InstancedMesh; base: Float32Array }[] = [];

  // The real companion.
  private readonly stage = new THREE.Group();
  private stageBase = new THREE.Vector3();
  private mixer: THREE.AnimationMixer | null = null;
  private creatureRoot: THREE.Object3D | null = null;

  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private observer: ResizeObserver;

  constructor(host: HTMLElement, canvas: HTMLCanvasElement, callbacks: Callbacks = {}) {
    this.host = host;
    this.callbacks = callbacks;
    this.mobile = matchMedia("(pointer: coarse)").matches || window.innerWidth <= 700;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(this.mobile ? 1.4 : Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    configureHabitatRenderer(this.renderer);

    configureHabitatShadow(this.key, this.mobile);
    this.fill.position.set(-3, 2, 4);
    this.moon.position.set(-4.5, 7, -5);
    this.rim.position.set(0, 3.8, -7);
    this.companionRim.target = this.companionRimTarget;
    this.scene.add(
      this.ambient, this.fill, this.moon, this.rim, this.key,
      this.companionRim, this.companionRimTarget, this.stage,
    );

    const perspective = () => new THREE.PerspectiveCamera(FOV, 1, 0.05, 300);
    this.views = {
      pano: { id: "pano", camera: perspective(), yaw: 0, pitch: 0.13, dist: 7, zoom: 1, target: new THREE.Vector3(0, 1.6, 0), custom: false },
      mobile: { id: "mobile", camera: perspective(), yaw: 0, pitch: 0.13, dist: 5, zoom: 1, target: new THREE.Vector3(0, 2.9, 0), custom: false },
      top: { id: "top", camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200), yaw: 0, pitch: 0, dist: 0, zoom: 1, target: new THREE.Vector3(0, 0, OZ + (GZ - 1) / 2), custom: false },
    };

    // Raised and painted ground, drawn with the meadow's own painted texture.
    const material = new THREE.MeshStandardMaterial({ map: meadowTexture(), roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
    const uniforms = {
      uPath: { value: new THREE.Color(0xb6a777) },
      uSand: { value: new THREE.Color(0xd3c28a) },
      uRock: { value: new THREE.Color(0x7e877f) },
      uEarth: { value: new THREE.Color(0x8c6c46) },
    };
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 aMix; varying vec4 vMix; varying vec3 vOverlayWorld;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMix = aMix; vOverlayWorld = position;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec4 vMix; varying vec3 vOverlayWorld; uniform vec3 uPath; uniform vec3 uSand; uniform vec3 uRock; uniform vec3 uEarth;")
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
float macroA = sin(vOverlayWorld.x * 0.12) * cos(vOverlayWorld.z * 0.10);
float macroB = sin((vOverlayWorld.x + vOverlayWorld.z) * 0.045);
diffuseColor.rgb *= 1.0 + macroA * 0.055 + macroB * 0.035;
vec3 painted = mix(diffuseColor.rgb, uPath, vMix.x);
painted = mix(painted, uSand, vMix.y);
painted = mix(painted, uRock, vMix.z);
painted = mix(painted, uEarth, vMix.w);
diffuseColor.rgb = painted;`,
        );
    };
    material.customProgramCacheKey = () => "habitat-editor-overlay-v1";
    this.overlay = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.overlay.receiveShadow = true;
    this.overlay.castShadow = true;
    this.overlay.frustumCulled = false;

    this.gridLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, fog: false }),
    );
    this.gridLines.frustumCulled = false;
    this.gridLines.renderOrder = 6;

    const cursorGeometry = new THREE.BufferGeometry();
    cursorGeometry.setAttribute("position", new THREE.BufferAttribute(this.cursorPos, 3));
    const cursorIndex = new Uint16Array(25 * 96);
    {
      let n = 0;
      for (let t = 0; t < 25; t++)
        for (let b = 0; b < 4; b++)
          for (let a = 0; a < 4; a++) {
            const p = t * 25 + b * 5 + a;
            cursorIndex.set([p, p + 5, p + 1, p + 1, p + 5, p + 6], n);
            n += 6;
          }
    }
    cursorGeometry.setIndex(new THREE.BufferAttribute(cursorIndex, 1));
    this.cursor = new THREE.Mesh(
      cursorGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xe3b341, transparent: true, opacity: 0.42, depthWrite: false,
        side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2,
        polygonOffsetUnits: -2, fog: false,
      }),
    );
    this.cursor.frustumCulled = false;
    this.cursor.visible = false;
    this.cursor.renderOrder = 7;

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.88, 1, 40),
      new THREE.MeshBasicMaterial({ color: 0xe3b341, side: THREE.DoubleSide, depthTest: false, transparent: true, fog: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 9;
    this.ring.visible = false;
    this.scene.add(this.overlay, this.gridLines, this.cursor, this.ring);

    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(host);
  }

  // ---- Lifecycle -------------------------------------------------------------

  /** Opens a blank diorama (optionally with saved data) or the game's real scene as a preview. */
  async init(target: Target) {
    await this.open(target);
    if (this.disposed) return;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  async open(target: Target) {
    const run = ++this.generation;
    this.kind = target.kind;
    this.entries = [];
    this.selected = null;
    this.creatureSelected = false;
    this.map.clear();
    const data = target.kind === "diorama" ? target.data : null;
    if (target.kind === "diorama") {
      this.size = target.size;
      this.map.region = HabitatWorld.regionFor(target.size);
      const mid = HabitatWorld.centerTile();
      this.creature = { x: OX + mid.i, z: OZ + mid.j };
      if (data) {
        this.period = data.period;
        this.map.load(data.tiles);
        this.creature = { ...data.creature };
        if (data.lighting) this.lighting = { ...DEFAULT_LIGHTING, ...data.lighting };
      }
    } else {
      this.map.region = { i0: 0, j0: 0, i1: GX - 1, j1: GZ - 1 };
      this.creature = { x: 0, z: CREATURE_Z };
    }
    this.buildEnv(target.kind === "preview");
    await this.env.ready;
    if (this.disposed || run !== this.generation) return;
    if (data) await this.spawnAll(data.props);
    else if (target.kind === "preview") this.adoptDefaultProps();
    if (run !== this.generation) return;
    if (this.creatureModel) this.setCreature(this.creatureModel);
    this.clearCreatureWater();
    this.refreshTerrain();
    for (const v of Object.values(this.views)) v.custom = false;
    this.layout();
  }

  static regionFor(size: DioramaSize): Region {
    const mid = HabitatWorld.centerTile();
    // Odd sizes have a true middle tile; the creature starts on it.
    const i0 = mid.i - Math.floor(size / 2),
      j0 = mid.j - Math.floor(size / 2);
    return { i0, j0, i1: i0 + size - 1, j1: j0 + size - 1 };
  }
  /** Tile the creature starts on: the middle of the diorama. */
  static centerTile() {
    return { i: 16, j: 25 };
  }
  /** An empty diorama: every tile at its defaults, the creature in the middle. */
  static blank(size: DioramaSize, period: WorldPeriod, lighting?: Lighting): SceneData {
    const mid = HabitatWorld.centerTile();
    return {
      version: 2,
      kind: "diorama",
      size,
      period,
      tiles: new TileMap().serialize(),
      props: [],
      creature: { x: OX + mid.i, z: OZ + mid.j },
      lighting,
    };
  }
  /** Whether a tile can be edited in the current scene. */
  get editable() {
    return this.kind === "diorama";
  }
  /** Centre of the editable area in world metres. */
  get centre() {
    const r = this.map.region;
    return { x: OX + (r.i0 + r.i1) / 2, z: OZ + (r.j0 + r.j1) / 2 };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.env?.dispose();
    this.overlay.geometry.dispose();
    (this.overlay.material as THREE.Material).dispose();
    this.gridLines.geometry.dispose();
    this.cursor.geometry.dispose();
    this.ring.geometry.dispose();
    this.lakeMesh?.geometry.dispose();
    this.bankMesh?.geometry.dispose();
    this.baseTop?.geometry.dispose();
    this.baseSides?.geometry.dispose();
    this.mixer?.stopAllAction();
    this.renderer.dispose();
  }

  private buildEnv(defaultProps: boolean) {
    this.env?.dispose();
    this.entries.forEach((e) => (e.prop = null));
    const diorama = this.kind === "diorama";
    this.env = meadow(this.scene, this.period, {
      grassExclusions: diorama ? [] : [{ x: 0, z: CREATURE_Z, radius: 1.35 }],
      props: defaultProps,
      scenery: !diorama,
      skyBodies: !this.callbacks.ownSky,
      skyRange: this.callbacks.ownSky ? [-0.6, 0.14] : undefined,
    });
    this.applyLights();
    this.lakeMesh?.removeFromParent();
    this.bankMesh?.removeFromParent();
    this.lakeMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.env.waterMaterial);
    this.lakeMesh.renderOrder = 2;
    this.lakeMesh.frustumCulled = false;
    this.bankMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.env.bankMaterial);
    this.bankMesh.receiveShadow = true;
    this.bankMesh.frustumCulled = false;
    this.scene.add(this.bankMesh, this.lakeMesh);
    this.baseTop?.removeFromParent();
    this.baseSides?.removeFromParent();
    this.baseTop = this.baseSides = null;
    const cam = this.key.shadow.camera;
    if (diorama) {
      // A floating block of earth: the game's far meadow, lake and trail are not part of it.
      this.env.floor.visible = false;
      this.env.lake.visible = false;
      this.env.bank.visible = false;
      this.env.path.visible = false;
      if (!this.callbacks.ownBase) this.buildBase();
      this.refillCarpet();
      const half = Math.max(4.5, this.size * 0.8);
      cam.left = cam.bottom = -half;
      cam.right = cam.top = half;
    } else {
      this.env.floor.visible = true;
      cam.left = cam.bottom = -13;
      cam.right = cam.top = 13;
    }
    cam.updateProjectionMatrix();
    this.instanced = [this.env.grass, ...this.env.flowers].map((mesh) => {
      mesh.frustumCulled = false;
      return { mesh, base: Float32Array.from(mesh.instanceMatrix.array) };
    });
    this.placeCreature();
  }

  /** Earth block under a diorama: grass-painted top, bare earth sides. */
  private buildBase() {
    const r = this.map.region;
    const x0 = OX + r.i0 - 0.5,
      x1 = OX + r.i1 + 0.5,
      z0 = OZ + r.j0 - 0.5,
      z1 = OZ + r.j1 + 0.5,
      d = BASE_DEPTH;
    const top = new THREE.BufferGeometry();
    top.setAttribute("position", new THREE.Float32BufferAttribute([x0, 0, z0, x0, 0, z1, x1, 0, z1, x1, 0, z0], 3));
    top.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    const uv = (x: number, z: number) => [(x + 60) / 120, (60 - z) / 120];
    top.setAttribute("uv", new THREE.Float32BufferAttribute([...uv(x0, z0), ...uv(x0, z1), ...uv(x1, z1), ...uv(x1, z0)], 2));
    top.setIndex([0, 1, 2, 0, 2, 3]);
    this.baseTop = new THREE.Mesh(top, new THREE.MeshStandardMaterial({ map: meadowTexture(), roughness: 0.96 }));
    this.baseTop.receiveShadow = true;
    const quad = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number) => ({
      p: [ax, 0, az, bx, 0, bz, bx, -d, bz, ax, -d, az],
      n: [nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz],
    });
    const faces = [
      quad(x0, z1, x1, z1, 0, 1),
      quad(x1, z1, x1, z0, 1, 0),
      quad(x1, z0, x0, z0, 0, -1),
      quad(x0, z0, x0, z1, -1, 0),
    ];
    const sides = new THREE.BufferGeometry();
    sides.setAttribute("position", new THREE.Float32BufferAttribute(faces.flatMap((f) => f.p), 3));
    sides.setAttribute("normal", new THREE.Float32BufferAttribute(faces.flatMap((f) => f.n), 3));
    sides.setIndex(faces.flatMap((_, f) => [f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3]));
    this.baseSides = new THREE.Mesh(
      sides,
      new THREE.MeshStandardMaterial({ color: 0x7a5a3b, roughness: 1, side: THREE.DoubleSide }),
    );
    this.baseSides.receiveShadow = true;
    this.baseSides.castShadow = true;
    this.scene.add(this.baseTop, this.baseSides);
  }

  /** The scattered carpet tufts can be hidden (the player's world keeps the bare ground). */
  setCarpetVisible(visible: boolean) {
    this.env.grass.visible = visible;
  }

  /** The game's carpet covers a fixed patch of meadow; spread the same tufts over the diorama instead. */
  private refillCarpet() {
    const mesh = this.env.grass;
    const r = this.map.region;
    const x0 = OX + r.i0 - 0.5,
      z0 = OZ + r.j0 - 0.5,
      w = r.i1 - r.i0 + 1,
      h = r.j1 - r.j0 + 1;
    const count = mesh.count;
    const used = Math.min(count, Math.round(w * h * 9));
    const dummy = new THREE.Object3D();
    let seed = 8163;
    const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967295;
    for (let k = 0; k < count; k++) {
      if (k >= used) {
        dummy.scale.setScalar(0);
        dummy.position.set(0, -50, 0);
      } else {
        const sc = (0.7 + rand() * 0.65) * 0.55;
        dummy.position.set(x0 + rand() * w, 0.012, z0 + rand() * h);
        dummy.rotation.set(0, rand() * Math.PI, 0);
        dummy.scale.set(sc, sc, sc);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    for (const flowers of this.env.flowers) flowers.count = 0;
  }

  // ---- Physics rules ------------------------------------------------------------

  /** Painted water on this tile. */
  wet(i: number, j: number) {
    return TileMap.inBounds(i, j) && this.map.water[TileMap.index(i, j)] === 1;
  }
  /** The creature is a solid body that occupies exactly its own tile. */
  private creatureBlocks(i: number, j: number) {
    const c = this.creatureTile();
    return i === c.i && j === c.j;
  }
  private solidOn(i: number, j: number, ignore?: PropEntry) {
    return this.entries.some((e) => {
      if (e === ignore || COVER.includes(e.key) || WATER_PROPS.includes(e.key)) return false;
      return footprint(e.key, e.x, e.z, e.r).some(([ti, tj]) => ti === i && tj === j);
    });
  }
  private anyPropOn(i: number, j: number) {
    return this.entries.some((e) => {
      if (WATER_PROPS.includes(e.key)) return false;
      return footprint(e.key, e.x, e.z, e.r).some(([ti, tj]) => ti === i && tj === j);
    });
  }
  /** Water never sits under the creature, whatever an old save says. */
  clearCreatureWater() {
    const c = this.creatureTile();
    if (TileMap.inBounds(c.i, c.j)) this.map.water[TileMap.index(c.i, c.j)] = 0;
  }
  private notice(message: string) {
    this.callbacks.onNotice?.(message);
  }
  /** Why a prop cannot stand on this tile, or null if it can. */
  /** Extra rule from the host (the player's board edge, rebyters standing about). */
  tileFilter: ((i: number, j: number) => boolean) | null = null;
  /** Why a prop (all the tiles it covers) cannot stand at this centre, or null if it can. */
  placementBlock(key: AssetKey, x: number, z: number, r: number, ignore?: PropEntry) {
    for (const [i, j] of footprint(key, x, z, r)) {
      const why = this.propBlock(key, i, j, ignore);
      if (why) return why;
    }
    return null;
  }
  private propBlock(key: AssetKey, i: number, j: number, ignore?: PropEntry) {
    if (!this.map.inside(i, j)) return "Fuera del diorama.";
    if (this.tileFilter && !this.tileFilter(i, j)) return "No hay lugar ahí.";
    if (!WATER_PROPS.includes(key) && this.wet(i, j)) return "Ese objeto no puede ir sobre el agua.";
    if (this.creatureBlocks(i, j)) return "La criatura ocupa esa baldosa.";
    if (!COVER.includes(key) && !WATER_PROPS.includes(key) && this.solidOn(i, j, ignore))
      return "Ya hay un objeto sólido en esa baldosa.";
    return null;
  }

  private applyLights() {
    const period = this.period;
    this.baseExposure =
      period === "Night" ? 0.98 : period === "Evening" ? 1.01 : period === "Morning" ? 1.07 : 1.05;
    this.renderer.toneMappingExposure = this.baseExposure * this.lighting.exposure;
    this.fill.color.setHex(period === "Evening" ? 0xffd9b3 : period === "Night" ? 0xaecbff : 0xffefd9);
    this.rim.color.setHex(period === "Evening" ? 0xffd1ad : period === "Night" ? 0x8fcaff : 0xccecff);
    this.companionRim.color.setHex(
      period === "Evening" ? 0xffd0ac : period === "Night" ? 0xa9d6ff : period === "Morning" ? 0xffe1bf : 0xd8f2ff,
    );
    this.companionRim.intensity =
      period === "Night" ? 0.88 : period === "Evening" ? 0.68 : period === "Morning" ? 0.48 : 0.52;
    this.placeSun();
    this.ambient.color.setHex(period === "Night" ? 0xa9c7ff : 0xd9efff);
    this.syncLightColors();
  }
  private syncLightColors() {
    const c = this.env.colors,
      l = this.lighting;
    this.key.color.setHex(c.light);
    if (l.warmth) this.key.color.lerp(this.tint.setHex(l.warmth > 0 ? 0xffa45c : 0x8fb8ff), Math.abs(l.warmth) * 0.55);
    this.key.intensity = c.intensity * l.sun;
    this.ambient.intensity = c.ambientIntensity * l.ambient;
    this.fill.intensity = c.fillIntensity * l.ambient;
    this.moon.intensity = c.moonIntensity * l.sun;
    this.rim.intensity = c.rimIntensity * l.rim;
  }
  private readonly tint = new THREE.Color();
  /** The game's sun position, turned and raised by the editor controls. */
  private placeSun() {
    const base = this.env.lightPosition;
    const r = base.length() || 1;
    const az = Math.atan2(base.x, base.z) + THREE.MathUtils.degToRad(this.lighting.azimuth);
    const el = clamp(
      Math.asin(clamp(base.y / r, -1, 1)) + THREE.MathUtils.degToRad(this.lighting.elevation),
      0.08,
      1.5,
    );
    this.key.position.set(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r);
  }
  setLighting(change: Partial<Lighting>) {
    const shadowsChanged = change.shadows !== undefined && change.shadows !== this.lighting.shadows;
    this.lighting = { ...this.lighting, ...change };
    this.renderer.toneMappingExposure = this.baseExposure * this.lighting.exposure;
    this.placeSun();
    if (shadowsChanged) this.key.castShadow = this.lighting.shadows;
    this.env.markShadowsDirty();
  }

  /** The real world-clock time, so twilight follows the actual hour. */
  clockMs: number | null = null;

  async setPeriod(period: WorldPeriod) {
    if (period === this.period) return;
    this.period = period;
    const list = this.entries.map(({ id, key, x, z, h, r }) => ({ id, key, x, z, h, r }));
    this.buildEnv(false);
    await this.env.ready;
    this.entries = [];
    await this.spawnAll(list);
    this.refreshTerrain();
  }

  // ---- Props -----------------------------------------------------------------

  private adoptDefaultProps() {
    this.entries = this.env.props.map((prop) => ({
      id: this.nextId++, key: prop.key, x: prop.x, z: prop.z, h: prop.h, r: prop.r, baseH: prop.h, prop,
    }));
  }
  private async spawnEntry(data: PropData & { id?: number }) {
    const prop = await this.env.spawn(data.key, data.x, data.z, data.h, data.r);
    if (!prop || this.disposed) return null;
    const entry: PropEntry = {
      id: data.id ?? this.nextId++, key: data.key, x: data.x, z: data.z, h: data.h, r: data.r, baseH: data.h, prop,
    };
    this.nextId = Math.max(this.nextId, entry.id + 1);
    this.entries.push(entry);
    this.applyEntry(entry);
    return entry;
  }
  private async spawnAll(list: (PropData & { id?: number })[]) {
    await Promise.all(list.map((item) => this.spawnEntry(item)));
  }
  private applyEntry(entry: PropEntry) {
    const prop = entry.prop;
    if (!prop) return;
    const y = this.map.heightAt(entry.x, entry.z);
    prop.node.position.set(entry.x, y, entry.z);
    prop.node.rotation.y = entry.r;
    prop.node.scale.setScalar(entry.h / entry.baseH);
    prop.contact?.position.set(entry.x, y + 0.022, entry.z);
    prop.contact?.scale.set(entry.h * 0.36, entry.h * 0.3, 1);
  }
  /** Props are drawn at game size; a diorama's creature is smaller, so its props are too. */
  get propScale() {
    return this.kind === "diorama" ? 0.5 : 1;
  }
  async addProp(key: AssetKey, x: number, z: number, rotation?: number) {
    const item = PROP_CATALOG.find((p) => p.key === key);
    const tile = TileMap.tileOf(x, z);
    const r =
      rotation ??
      (FRONT_FACING.includes(key)
        ? facingInward(OX + tile.i, OZ + tile.j, OX + (this.map.region.i0 + this.map.region.i1) / 2, OZ + (this.map.region.j0 + this.map.region.j1) / 2)
        : Math.random() * Math.PI * 2);
    let at = { x: OX + tile.i, z: OZ + tile.j };
    let why = this.placementBlock(key, at.x, at.z, r);
    if (why && spanOf(key) > 1) {
      // A wide prop starts at the tapped tile and runs either way along its width.
      for (const side of [1, -1]) {
        at = spanCenter(key, tile.i, tile.j, r, side);
        why = this.placementBlock(key, at.x, at.z, r);
        if (!why) break;
      }
    }
    if (why) {
      this.notice(why);
      return null;
    }
    return this.spawnEntry({ key, x: at.x, z: at.z, h: (item?.h ?? 1) * this.propScale, r });
  }
  /** Tufts of tall grass scattered inside the given tiles (one visit per tile). */
  async addCover(key: AssetKey, tiles: [number, number][], visited: Set<number>) {
    const item = PROP_CATALOG.find((p) => p.key === key);
    const cover = this.entries.filter((e) => COVER.includes(e.key)).length;
    let placed = 0;
    for (const [i, j] of tiles) {
      const k = TileMap.index(i, j);
      if (visited.has(k)) continue;
      visited.add(k);
      if (this.propBlock(key, i, j) || cover + placed >= MAX_COVER) continue;
      for (let n = 0; n < 2; n++) {
        const x = OX + i + (Math.random() - 0.5) * 0.8,
          z = OZ + j + (Math.random() - 0.5) * 0.8;
        const h = (item?.h ?? 0.9) * this.propScale * (0.75 + Math.random() * 0.5);
        if (await this.spawnEntry({ key, x, z, h, r: Math.random() * Math.PI * 2 })) placed++;
      }
    }
    return placed;
  }
  /** Removes props standing in the given tiles; `only` limits it to some kinds. */
  eraseProps(tiles: [number, number][], only?: AssetKey[]) {
    const wanted = new Set(tiles.map(([i, j]) => TileMap.index(i, j)));
    let removed = 0;
    for (const entry of [...this.entries]) {
      if (only && !only.includes(entry.key)) continue;
      if (footprint(entry.key, entry.x, entry.z, entry.r).some(([i, j]) => wanted.has(TileMap.index(i, j)))) {
        this.removeProp(entry);
        removed++;
      }
    }
    return removed;
  }
  /** Takes the tall grass carpet away from (or gives it back to) the tiles. */
  paintCut(tiles: [number, number][], cut: boolean, visited: Set<number>) {
    let changed = false;
    for (const [i, j] of tiles) {
      const k = TileMap.index(i, j);
      if (visited.has(k)) continue;
      visited.add(k);
      const value = cut ? 1 : 0;
      if (this.map.cut[k] !== value) {
        this.map.cut[k] = value;
        changed = true;
      }
    }
    return changed;
  }
  removeProp(entry: PropEntry) {
    if (entry.prop) this.env.removeProp(entry.prop);
    this.entries = this.entries.filter((e) => e !== entry);
    if (this.selected === entry) this.select(null);
  }
  moveProp(entry: PropEntry, x: number, z: number) {
    const tile = TileMap.tileOf(x, z);
    // A wide prop moves with its first tile on the tapped tile, running either way.
    let at = spanCenter(entry.key, tile.i, tile.j, entry.r);
    let why = this.placementBlock(entry.key, at.x, at.z, entry.r, entry);
    if (why && spanOf(entry.key) > 1) {
      at = spanCenter(entry.key, tile.i, tile.j, entry.r, -1);
      why = this.placementBlock(entry.key, at.x, at.z, entry.r, entry);
    }
    if (why) {
      this.notice(why);
      return false;
    }
    entry.x = at.x;
    entry.z = at.z;
    this.applyEntry(entry);
    this.updateRing();
    this.env.markShadowsDirty();
    return true;
  }
  /**
   * Turns a prop. Single-tile props turn by `delta` radians; wide props turn a quarter
   * at a time around their first tile, and only if the new spot is free.
   */
  rotateProp(entry: PropEntry, delta: number) {
    if (spanOf(entry.key) === 1) {
      this.updateProp(entry, { r: entry.r + delta });
      return true;
    }
    const [first] = footprint(entry.key, entry.x, entry.z, entry.r);
    const r = entry.r + Math.sign(delta) * (Math.PI / 2);
    const at = spanCenter(entry.key, first[0], first[1], r);
    const why = this.placementBlock(entry.key, at.x, at.z, r, entry);
    if (why) {
      this.notice(why);
      return false;
    }
    entry.x = at.x;
    entry.z = at.z;
    this.updateProp(entry, { r });
    return true;
  }
  /** Slides a prop inside its own tile (to the edge at most), so rows of props need not line up. */
  nudgeProp(entry: PropEntry, dx: number, dz: number) {
    if (spanOf(entry.key) > 1) return;
    const tile = TileMap.tileOf(entry.x, entry.z);
    const limit = 0.45;
    const cx = OX + tile.i,
      cz = OZ + tile.j;
    entry.x = clamp(entry.x + dx, cx - limit, cx + limit);
    entry.z = clamp(entry.z + dz, cz - limit, cz + limit);
    this.applyEntry(entry);
    this.updateRing();
    this.env.markShadowsDirty();
  }
  updateProp(entry: PropEntry, change: Partial<Pick<PropData, "h" | "r">>) {
    Object.assign(entry, change);
    this.applyEntry(entry);
    this.updateRing();
    this.env.markShadowsDirty();
  }
  select(entry: PropEntry | null) {
    this.selected = entry;
    if (entry) this.creatureSelected = false;
    this.updateRing();
  }
  private updateRing() {
    const e = this.selected;
    this.ring.visible = !!e || this.creatureSelected;
    if (!e) {
      if (this.creatureSelected) {
        this.ring.position.set(this.creature.x, this.map.heightAt(this.creature.x, this.creature.z) + 0.07, this.creature.z);
        this.ring.scale.set(0.62, 0.62, 1);
      }
      return;
    }
    const radius = clamp(e.h * 0.28, 0.5, 1.8);
    this.ring.position.set(e.x, this.map.heightAt(e.x, e.z) + 0.07, e.z);
    this.ring.scale.set(radius, radius, 1);
  }
  /** Prop under the pointer: a ray against the prop meshes. */
  pickProp(px: number, py: number, pane: Pane) {
    this.aim(px, py, pane);
    const nodes = this.entries.flatMap((e) => (e.prop ? [e.prop.node] : []));
    const hit = this.raycaster.intersectObjects(nodes, true)[0];
    if (!hit) return null;
    let node: THREE.Object3D | null = hit.object;
    while (node) {
      const found = this.entries.find((e) => e.prop?.node === node);
      if (found) return found;
      node = node.parent;
    }
    return null;
  }

  // ---- Companion -------------------------------------------------------------

  setCreature(model: AssetModel) {
    this.creatureModel = model;
    if (this.creatureRoot) {
      this.stage.remove(this.creatureRoot);
      this.mixer?.stopAllAction();
    }
    const root = clone(model.scene);
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      const prepare = (source: THREE.Material) => {
        const material = source.clone();
        if (material instanceof THREE.MeshStandardMaterial) {
          if (!material.emissiveMap && material.emissive.getHex() === 0)
            material.emissiveIntensity = 0;
          material.needsUpdate = true;
        }
        return material;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(prepare) : prepare(mesh.material);
    });
    this.stage.add(root);
    this.stage.position.set(0, 0, 0);
    this.stage.scale.setScalar(1);
    this.stage.updateMatrixWorld(true);
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const framing = 2 / Math.max(size.x, size.y, size.z, 0.001);
    // In the game the companion fills the frame; in a diorama it stands on one tile.
    const scale =
      this.kind === "diorama"
        ? 0.92 / Math.max(size.x, size.y, size.z, 0.001)
        : framing * CREATURE_SCALE;
    this.stage.scale.setScalar(scale);
    this.stageBase.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    this.creatureSpan = size.x * framing;
    this.creatureExtent = Math.max(size.x, size.y, size.z) * scale;
    this.creatureRoot = root;
    const normalize = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const idle = model.clips.find((c) => clipNames.includes(normalize(c.name)));
    this.creatureClip = idle ?? null;
    this.mixer = new THREE.AnimationMixer(root);
    if (idle) this.mixer.clipAction(idle).play();
    this.placeCreature(true);
    for (const v of Object.values(this.views)) v.custom = false;
    this.layout();
  }
  private placeCreature(snap = false) {
    // The creature stands on exactly one tile and rides that tile's height.
    const y = this.map.heightAt(this.creature.x, this.creature.z) + (this.env?.groundY ?? 0.04);
    this.restY = y + this.stageBase.y;
    this.stage.position.set(
      this.creature.x + this.stageBase.x,
      this.stage.position.y === 0 || snap ? this.restY : this.stage.position.y,
      this.creature.z + this.stageBase.z,
    );
    this.env?.setCompanionShadowPosition(this.creature.x, this.creature.z, !this.external);
    this.companionRim.visible = !this.external;
    this.companionRim.position.set(this.creature.x - 0.15, y + 2.45, this.creature.z - 2.15);
    this.companionRimTarget.position.set(this.creature.x, y + 1.0, this.creature.z);
  }
  moveCreature(x: number, z: number) {
    const tile = TileMap.tileOf(x, z);
    if (!this.map.inside(tile.i, tile.j)) return false;
    const here = this.creatureTile();
    if (tile.i === here.i && tile.j === here.j) return false;
    if (this.wet(tile.i, tile.j)) {
      this.notice("La criatura no puede pararse en el agua.");
      return false;
    }
    if (this.solidOn(tile.i, tile.j)) {
      this.notice("Hay un objeto en esa baldosa.");
      return false;
    }
    this.creature = { x: OX + tile.i, z: OZ + tile.j };
    this.placeCreature();
    this.applyMasks();
    this.updateRing();
    this.env.markShadowsDirty();
    this.reframe();
    return true;
  }
  /** True when the pointer is over the creature's body. */
  pickCreature(px: number, py: number, pane: Pane) {
    this.aim(px, py, pane);
    return this.raycaster.intersectObject(this.stage, true).length > 0;
  }
  selectCreature(on: boolean) {
    this.creatureSelected = on;
    if (on) this.selected = null;
    this.updateRing();
  }

  // ---- Hosting -----------------------------------------------------------------

  /** Hands the frame over to a host with its own camera (or takes it back with null). */
  setExternal(host: { camera: THREE.Camera; update: (dt: number, now: number) => void } | null) {
    this.external = host;
    this.placeCreature();
  }
  /** Height of the grass surface above a flat tile. */
  get groundY() {
    return this.env?.groundY ?? 0.04;
  }
  /** Asks for the sun's shadows to be redrawn (they are not refreshed every frame). */
  markShadowsDirty() {
    this.env?.markShadowsDirty();
  }
  /** Whether something walking can stand on this tile: inside, dry and without a solid prop. */
  canStand(i: number, j: number) {
    return this.map.inside(i, j) && !this.wet(i, j) && !this.solidOn(i, j) && this.map.level[TileMap.index(i, j)] < CLIFF_LEVEL;
  }
  /** Whether a prop of this kind could be put on this tile. */
  propBlockReason(key: AssetKey, i: number, j: number, ignore?: PropEntry) {
    return this.propBlock(key, i, j, ignore);
  }

  // ---- Terrain editing -------------------------------------------------------

  brushTiles(i: number, j: number, size: number) {
    const radius = size === 1 ? 0 : size === 3 ? 1.5 : 2.5;
    const reach = Math.ceil(radius);
    const tiles: [number, number][] = [];
    for (let dj = -reach; dj <= reach; dj++)
      for (let di = -reach; di <= reach; di++)
        if (di * di + dj * dj <= radius * radius + 0.01 && this.map.inside(i + di, j + dj))
          tiles.push([i + di, j + dj]);
    return tiles;
  }
  creatureTile() {
    return TileMap.tileOf(this.creature.x, this.creature.z);
  }
  paintGround(tiles: [number, number][], ground: Ground, visited: Set<number>) {
    const code = ["grass", "path", "sand", "rock"].indexOf(ground);
    let changed = false;
    for (const [i, j] of tiles) {
      const k = TileMap.index(i, j);
      if (visited.has(k)) continue;
      visited.add(k);
      if (this.map.ground[k] !== code) {
        this.map.ground[k] = code;
        changed = true;
      }
    }
    return changed;
  }
  paintWater(tiles: [number, number][], add: boolean, visited: Set<number>) {
    const home = this.creatureTile();
    let changed = false;
    let blocked = "";
    for (const [i, j] of tiles) {
      const k = TileMap.index(i, j);
      if (visited.has(k)) continue;
      visited.add(k);
      if (add) {
        if (this.map.water[k]) continue;
        if (i === home.i && j === home.j) {
          blocked = "El agua no puede cubrir a la criatura.";
          continue;
        }
        if (this.anyPropOn(i, j)) {
          blocked = "El agua no puede cubrir un objeto.";
          continue;
        }
        this.map.water[k] = 1;
        this.map.level[k] = 0;
        changed = true;
      } else if (this.map.water[k]) {
        this.map.water[k] = 0;
        changed = true;
      }
    }
    if (blocked) this.notice(blocked);
    return changed;
  }
  sculpt(tiles: [number, number][], up: boolean, visited: Set<number>) {
    let changed = false;
    for (const [i, j] of tiles) {
      const k = TileMap.index(i, j);
      if (visited.has(k)) continue;
      visited.add(k);
      if (up) {
        if (this.map.water[k]) {
          this.map.water[k] = 0;
          changed = true;
        } else if (this.map.level[k] < MAX_LEVEL) {
          this.map.level[k]++;
          changed = true;
        }
      } else if (!this.map.water[k] && this.map.level[k] > 0) {
        this.map.level[k]--;
        changed = true;
      }
    }
    return changed;
  }
  /** Back to the original meadow: no paint, no relief, no water. */
  resetTiles(tiles: [number, number][], visited: Set<number>) {
    let changed = false;
    for (const [i, j] of tiles) {
      const k = TileMap.index(i, j);
      if (visited.has(k)) continue;
      visited.add(k);
      if (this.map.ground[k] || this.map.level[k] || this.map.water[k]) {
        this.map.ground[k] = 0;
        this.map.level[k] = 0;
        this.map.water[k] = 0;
        changed = true;
      }
    }
    return changed;
  }
  /** Props standing on tiles that turned into water are removed; the rest follow the ground. */
  commitTerrain() {
    this.refreshTerrain();
  }
  refreshTerrain() {
    this.map.refresh();
    const swap = (mesh: THREE.Mesh | THREE.LineSegments, geometry: THREE.BufferGeometry | null) => {
      mesh.geometry.dispose();
      mesh.geometry = geometry ?? new THREE.BufferGeometry();
      mesh.visible = !!geometry;
    };
    swap(this.overlay, buildOverlayGeometry(this.map, this.kind === "diorama"));
    if (this.lakeMesh && this.bankMesh) {
      swap(this.lakeMesh, buildContourGeometry(this.map, 0.5, WATER_Y));
      swap(this.bankMesh, buildContourGeometry(this.map, 0.3, BANK_Y));
    }
    this.gridLines.geometry.dispose();
    this.gridLines.geometry = this.showGrid && this.kind === "diorama" ? buildGridGeometry(this.map) : new THREE.BufferGeometry();
    this.applyMasks();
    for (const entry of this.entries) this.applyEntry(entry);
    this.placeCreature();
    this.updateRing();
    this.env.markShadowsDirty();
    this.reframe();
  }
  setGrid(visible: boolean) {
    this.showGrid = visible;
    this.gridLines.geometry.dispose();
    this.gridLines.geometry = visible && this.kind === "diorama" ? buildGridGeometry(this.map) : new THREE.BufferGeometry();
  }
  /** Grass blades and flowers follow raised ground and disappear under water, paths and bare slopes. */
  private applyMasks() {
    const diorama = this.kind === "diorama";
    const modified = this.map.isModified();
    const mix = [0, 0, 0];
    for (const { mesh, base } of this.instanced) {
      const out = mesh.instanceMatrix.array as Float32Array;
      out.set(base);
      if (diorama || modified)
        for (let k = 0; k < mesh.count; k++) {
          const o = k * 16;
          if (base[o] === 0 && base[o + 2] === 0 && base[o + 5] === 0) continue;
          const x = base[o + 12],
            z = base[o + 14];
          let hide = this.map.cutAt(x, z) || this.map.waterAt(x, z) > 0.4;
          if (!hide && diorama) {
            const t = TileMap.tileOf(x, z);
            hide =
              !this.map.inside(t.i, t.j) ||
              Math.hypot(x - this.creature.x, z - this.creature.z) < 0.5;
          }
          if (!hide) {
            this.map.groundMix(x, z, mix);
            hide = mix[0] + mix[1] + mix[2] > 0.4 || this.map.slopeAt(x, z) > 0.3;
          }
          if (hide) out.fill(0, o, o + 12);
          else out[o + 13] = base[o + 13] + this.map.heightAt(x, z);
        }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ---- Cursor ----------------------------------------------------------------

  showCursor(tiles: [number, number][], color: number) {
    let n = 0;
    for (const [i, j] of tiles.slice(0, 25)) {
      for (let b = 0; b < 5; b++)
        for (let a = 0; a < 5; a++) {
          const x = OX + i - 0.5 + a / 4,
            z = OZ + j - 0.5 + b / 4,
            o = (n * 25 + b * 5 + a) * 3;
          this.cursorPos[o] = x;
          this.cursorPos[o + 1] = Math.max(this.map.heightAt(x, z), WATER_Y) + 0.05;
          this.cursorPos[o + 2] = z;
        }
      n++;
    }
    this.cursor.geometry.attributes.position.needsUpdate = true;
    this.cursor.geometry.setDrawRange(0, n * 96);
    (this.cursor.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.cursor.visible = n > 0;
  }
  hideCursor() {
    this.cursor.visible = false;
  }

  // ---- Snapshots -------------------------------------------------------------

  snapshot(): SceneData {
    return {
      version: 2,
      kind: "diorama",
      size: this.size,
      period: this.period,
      tiles: this.map.serialize(),
      props: this.entries.map(({ id, key, x, z, h, r }) => ({ id, key, x, z, h, r })),
      creature: { ...this.creature },
      lighting: { ...this.lighting },
    };
  }
  static isSceneData(data: unknown): data is SceneData {
    const d = data as SceneData;
    if (
      !d ||
      d.version !== 2 ||
      d.kind !== "diorama" ||
      !DIORAMA_SIZES.includes(d.size) ||
      !["Night", "Morning", "Day", "Evening"].includes(d.period) ||
      !d.tiles ||
      !TileMap.validate(d.tiles) ||
      !Array.isArray(d.props) ||
      !d.creature ||
      !Number.isFinite(d.creature.x) ||
      !Number.isFinite(d.creature.z)
    )
      return false;
    const region = HabitatWorld.regionFor(d.size);
    const c = TileMap.tileOf(d.creature.x, d.creature.z);
    return (
      c.i >= region.i0 &&
      c.i <= region.i1 &&
      c.j >= region.j0 &&
      c.j <= region.j1 &&
      d.props.every(
        (p) =>
          typeof p.key === "string" &&
          [p.x, p.z, p.h, p.r].every((n) => Number.isFinite(n)) &&
          p.h > 0,
      )
    );
  }
  /** Restores a snapshot of the same diorama, keeping props that did not change. */
  async restore(data: SceneData) {
    this.map.load(data.tiles);
    this.creature = { ...data.creature };
    if (data.period !== this.period) {
      this.period = data.period;
      this.buildEnv(false);
      await this.env.ready;
      this.entries = [];
      await this.spawnAll(data.props);
    } else {
      const wanted = new Map(data.props.map((p) => [p.id, p]));
      for (const entry of [...this.entries]) {
        const item = wanted.get(entry.id);
        if (item && item.key === entry.key) Object.assign(entry, { x: item.x, z: item.z, h: item.h, r: item.r });
        else this.removeProp(entry);
      }
      const present = new Set(this.entries.map((e) => e.id));
      await this.spawnAll(data.props.filter((p) => !present.has(p.id)));
    }
    this.select(null);
    this.clearCreatureWater();
    this.refreshTerrain();
  }

  // ---- Export -----------------------------------------------------------------

  /**
   * The diorama as a binary glTF, centred on the origin, in metres, Y up. Ground is
   * baked into vertex colours (the editor's shader has no glTF equivalent); props,
   * water and the creature (with its idle animation) come along as they stand.
   */
  async exportGlb(options: { creature: boolean; carpet: boolean }): Promise<ArrayBuffer> {
    if (this.kind !== "diorama") throw new Error("Solo se pueden descargar los dioramas.");
    const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
    const root = new THREE.Group();
    root.name = `diorama-${this.size}x${this.size}`;
    const c = this.centre;
    root.position.set(-c.x, 0, -c.z);

    const grass = new THREE.Color(0x5b7d33),
      path = new THREE.Color(0xb6a777),
      sand = new THREE.Color(0xd3c28a),
      rock = new THREE.Color(0x7e877f),
      earth = new THREE.Color(0x8c6c46);
    const ground = new THREE.Group();
    ground.name = "ground";
    if (this.baseTop) {
      const top = new THREE.Mesh(this.baseTop.geometry, new THREE.MeshStandardMaterial({ color: grass, roughness: 1 }));
      top.name = "ground-top";
      ground.add(top);
    }
    if (this.baseSides) {
      const sides = new THREE.Mesh(this.baseSides.geometry, this.baseSides.material);
      sides.name = "ground-sides";
      ground.add(sides);
    }
    if (this.overlay.visible) {
      const geometry = this.overlay.geometry.clone();
      const mix = geometry.getAttribute("aMix");
      const colors = new Float32Array(mix.count * 3);
      const tmp = new THREE.Color();
      for (let k = 0; k < mix.count; k++) {
        tmp.copy(grass)
          .lerp(path, mix.getX(k))
          .lerp(sand, mix.getY(k))
          .lerp(rock, mix.getZ(k))
          .lerp(earth, mix.getW(k));
        colors.set([tmp.r, tmp.g, tmp.b], k * 3);
      }
      geometry.deleteAttribute("aMix");
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }),
      );
      mesh.name = "ground-relief";
      ground.add(mesh);
    }
    root.add(ground);

    if (this.lakeMesh?.visible) {
      const water = new THREE.Mesh(
        this.lakeMesh.geometry,
        new THREE.MeshStandardMaterial({ color: 0x3aa6d0, roughness: 0.25, transparent: true, opacity: 0.88 }),
      );
      water.name = "water";
      root.add(water);
    }
    if (this.bankMesh?.visible) {
      const bank = new THREE.Mesh(this.bankMesh.geometry, new THREE.MeshStandardMaterial({ color: 0xa89466, roughness: 1 }));
      bank.name = "shore";
      root.add(bank);
    }

    const props = new THREE.Group();
    props.name = "props";
    for (const entry of this.entries) {
      if (!entry.prop) continue;
      const node = entry.prop.node.clone(true);
      node.name = entry.key;
      props.add(node);
    }
    root.add(props);

    if (options.carpet) {
      const carpet = this.env.grass.clone();
      carpet.name = "grass-carpet";
      root.add(carpet);
    }

    let animations: THREE.AnimationClip[] = [];
    if (options.creature && this.creatureRoot) {
      const copy = clone(this.creatureRoot);
      const holder = new THREE.Group();
      holder.name = "mammal.exe";
      holder.position.copy(this.stage.position);
      holder.scale.copy(this.stage.scale);
      holder.add(copy);
      root.add(holder);
      if (this.creatureClip) animations = [this.creatureClip];
    }
    root.updateMatrixWorld(true);
    const result = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true, animations });
    if (!(result instanceof ArrayBuffer)) throw new Error("No se pudo generar el GLB.");
    return result;
  }

  // ---- Views -----------------------------------------------------------------

  setMode(mode: ViewMode, view?: ViewId) {
    this.mode = mode;
    if (view) this.activeView = view;
    this.layout();
  }
  layout() {
    const W = this.host.clientWidth,
      H = this.host.clientHeight,
      g = 10;
    if (!W || !H || this.disposed) return;
    this.renderer.setSize(W, H, false);
    const fit = (s: { x: number; y: number; w: number; h: number }, aspect: number) => {
      if (!aspect) return s;
      let w = s.w,
        h = s.h;
      if (w / h > aspect) w = h * aspect;
      else h = w / aspect;
      return { x: s.x + (s.w - w) / 2, y: s.y + (s.h - h) / 2, w, h };
    };
    const aspects: Record<ViewId, number> = { pano: 16 / 10, mobile: 9 / 19.5, top: 0 };
    let slots: [ViewId, { x: number; y: number; w: number; h: number }][];
    if (this.mode !== "triple")
      slots = [[this.mode, { x: g, y: g, w: W - 2 * g, h: H - 2 * g }]];
    else if (W >= H * 1.05) {
      const lw = Math.round((W - 3 * g) * 0.52),
        rw = W - 3 * g - lw,
        ph = Math.round((H - 3 * g) * 0.4);
      slots = [
        ["top", { x: g, y: g, w: lw, h: H - 2 * g }],
        ["pano", { x: 2 * g + lw, y: g, w: rw, h: ph }],
        ["mobile", { x: 2 * g + lw, y: 2 * g + ph, w: rw, h: H - 3 * g - ph }],
      ];
    } else {
      const th = Math.round((H - 3 * g) * 0.4),
        bh = H - 3 * g - th,
        pw = Math.round((W - 3 * g) * 0.6),
        mw = W - 3 * g - pw;
      slots = [
        ["top", { x: g, y: g, w: W - 2 * g, h: th }],
        ["pano", { x: g, y: 2 * g + th, w: pw, h: bh }],
        ["mobile", { x: 2 * g + pw, y: 2 * g + th, w: mw, h: bh }],
      ];
    }
    this.panes = slots.map(([id, s]) => ({ id, ...fit(s, aspects[id]) }));
    for (const pane of this.panes) if (!this.views[pane.id].custom) this.frameDefault(pane);
    this.callbacks.onLayout?.(this.panes);
  }
  /** The game's own camera framing for the companion, or a view that fits the whole diorama. */
  private frameDefault(pane: Pane) {
    const v = this.views[pane.id];
    const aspect = pane.w / pane.h;
    if (this.kind === "diorama" && this.playerView && pane.id !== "top") {
      // The game's framing, scaled to this creature: same angle, same share of the frame.
      const portrait = pane.id === "mobile";
      const k = this.creatureExtent / 1.8;
      const direction = new THREE.Vector3(0, 0.6, 4.7).normalize();
      const distance =
        Math.max(
          portrait ? 4.8 : 6.8,
          this.creatureSpan / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * aspect * (portrait ? 0.42 : 0.54)),
        ) * k;
      const ground = this.map.heightAt(this.creature.x, this.creature.z);
      v.target.set(
        this.creature.x,
        ground + (1.6 + (portrait ? 0.7 + -CREATURE_Z * 0.22 : 0)) * k,
        this.creature.z,
      );
      v.dist = distance;
      v.yaw = Math.atan2(direction.x, direction.z);
      v.pitch = Math.asin(direction.y);
      return;
    }
    if (this.kind === "diorama") {
      const c = this.centre,
        n = this.size;
      if (pane.id === "top") {
        v.zoom = 1;
        v.target.set(c.x, 0, c.z);
        return;
      }
      const portrait = pane.id === "mobile";
      v.target.set(c.x, 0.25 + n * 0.04, c.z);
      v.dist = (n * 0.52) / (Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * Math.min(aspect, 1));
      v.yaw = portrait ? -0.45 : 0.4;
      v.pitch = portrait ? 0.62 : 0.5;
      return;
    }
    if (pane.id === "top") {
      v.zoom = 1;
      v.target.set(0, 0, OZ + (GZ - 1) / 2);
      return;
    }
    const portrait = pane.id === "mobile";
    const direction = new THREE.Vector3(0, 0.6, 4.7).normalize();
    const distance = Math.max(
      portrait ? 4.8 : 6.8,
      this.creatureSpan / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * aspect * (portrait ? 0.42 : 0.54)),
    );
    v.target.set(0, 1.6 + (portrait ? 0.7 + -CREATURE_Z * 0.22 : 0), 0);
    v.dist = distance;
    v.yaw = Math.atan2(direction.x, direction.z);
    v.pitch = Math.asin(direction.y);
  }
  private panBounds() {
    if (this.kind === "diorama") {
      const c = this.centre,
        m = this.size * 0.8;
      return { x0: c.x - m, x1: c.x + m, z0: c.z - m, z1: c.z + m };
    }
    return { x0: OX - 4, x1: OX + GX + 4, z0: OZ - 4, z1: OZ + GZ + 4 };
  }
  private reframe() {
    if (!this.playerView) return;
    for (const pane of this.panes) if (pane.id !== "top") this.frameDefault(pane);
  }
  /** Locks the perspective views to the player's camera, or frees them again. */
  setPlayerView(on: boolean) {
    this.playerView = on;
    for (const id of ["pano", "mobile"] as const) this.views[id].custom = false;
    this.layout();
  }
  resetView(id: ViewId) {
    this.views[id].custom = false;
    const pane = this.panes.find((p) => p.id === id);
    if (pane) this.frameDefault(pane);
  }
  orbit(id: ViewId, dx: number, dy: number) {
    const v = this.views[id];
    if (id === "top" || this.playerView) return;
    v.custom = true;
    v.yaw -= dx * 0.006;
    v.pitch = clamp(v.pitch + dy * 0.005, 0.03, 1.5);
  }
  pan(id: ViewId, dx: number, dy: number, pane: Pane) {
    const v = this.views[id];
    if (this.playerView && id !== "top") return;
    v.custom = true;
    if (id === "top") {
      const unit = (2 * this.topHalf(pane) * 1) / pane.h;
      const b = this.panBounds();
      v.target.x = clamp(v.target.x - dx * unit, b.x0, b.x1);
      v.target.z = clamp(v.target.z - dy * unit, b.z0, b.z1);
      return;
    }
    const unit = (2 * v.dist * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / pane.h;
    const rx = Math.cos(v.yaw),
      rz = -Math.sin(v.yaw),
      fx = -Math.sin(v.yaw),
      fz = -Math.cos(v.yaw);
    const b = this.panBounds();
    v.target.x = clamp(v.target.x - (rx * dx - fx * dy) * unit, b.x0, b.x1);
    v.target.z = clamp(v.target.z - (rz * dx - fz * dy) * unit, b.z0, b.z1);
  }
  zoom(id: ViewId, factor: number) {
    const v = this.views[id];
    if (this.playerView && id !== "top") return;
    v.custom = true;
    if (id === "top") v.zoom = clamp(v.zoom / factor, 0.5, 5);
    else v.dist = clamp(v.dist * factor, 1.5, this.kind === "diorama" ? 150 : 60);
  }
  private topHalf(pane: Pane) {
    const aspect = pane.w / pane.h;
    if (this.kind === "diorama") return Math.max(this.size * 0.62, (this.size * 0.62) / aspect) / this.views.top.zoom;
    return Math.max(19.5, 17.5 / aspect) / this.views.top.zoom;
  }
  private placeCamera(pane: Pane) {
    const v = this.views[pane.id];
    if (pane.id === "top") {
      const camera = v.camera as THREE.OrthographicCamera;
      const half = this.topHalf(pane),
        aspect = pane.w / pane.h;
      camera.left = -half * aspect;
      camera.right = half * aspect;
      camera.top = half;
      camera.bottom = -half;
      camera.position.set(v.target.x, 60, v.target.z);
      camera.up.set(0, 0, -1);
      camera.lookAt(v.target.x, 0, v.target.z);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      return camera;
    }
    const camera = v.camera as THREE.PerspectiveCamera;
    camera.aspect = pane.w / pane.h;
    const cp = Math.cos(v.pitch);
    camera.position.set(
      v.target.x + Math.sin(v.yaw) * cp * v.dist,
      v.target.y + Math.sin(v.pitch) * v.dist,
      v.target.z + Math.cos(v.yaw) * cp * v.dist,
    );
    camera.lookAt(v.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return camera;
  }

  // ---- Picking ---------------------------------------------------------------

  paneAt(px: number, py: number) {
    return this.panes.find((p) => px >= p.x && px <= p.x + p.w && py >= p.y && py <= p.y + p.h) ?? null;
  }
  private aim(px: number, py: number, pane: Pane) {
    this.ndc.set(((px - pane.x) / pane.w) * 2 - 1, -(((py - pane.y) / pane.h) * 2 - 1));
    this.raycaster.setFromCamera(this.ndc, this.placeCamera(pane));
  }
  /** Ground point and tile under the pointer, following raised terrain. */
  pickGround(px: number, py: number, pane: Pane) {
    this.aim(px, py, pane);
    const { origin, direction } = this.raycaster.ray;
    const above = (t: number) => {
      const x = origin.x + direction.x * t,
        z = origin.z + direction.z * t;
      return origin.y + direction.y * t - this.map.heightAt(x, z);
    };
    let near = 0;
    let far = -1;
    for (let t = 0.1; t < 150; t += 0.12) {
      if (above(t) <= 0) {
        far = t;
        break;
      }
      near = t;
    }
    if (far < 0) return null;
    for (let k = 0; k < 14; k++) {
      const mid = (near + far) / 2;
      if (above(mid) > 0) near = mid;
      else far = mid;
    }
    const x = origin.x + direction.x * far,
      z = origin.z + direction.z * far;
    const i = Math.round(x - OX),
      j = Math.round(z - OZ);
    if (!this.map.inside(i, j)) return null;
    return { x, z, i, j };
  }

  // ---- Frame loop --------------------------------------------------------------

  private tick = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    if (document.hidden || (!this.external && !this.panes.length)) return;
    const delta = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    if (!this.external) this.mixer?.update(delta);
    if (Math.abs(this.stage.position.y - this.restY) > 0.001) {
      this.stage.position.y += (this.restY - this.stage.position.y) * Math.min(1, delta * 12);
    }
    this.env.update(now / 1000, this.clockMs ?? fakeUnix(this.period));
    this.syncLightColors();
    if (this.env.consumeShadowUpdate()) this.renderer.shadowMap.needsUpdate = true;
    const r = this.renderer;
    const H = this.host.clientHeight;
    if (this.external) {
      this.external.update(delta, now);
      r.setScissorTest(false);
      r.setViewport(0, 0, this.host.clientWidth, H);
      r.clear();
      const fogSaved = this.scene.fog;
      this.scene.fog = null;
      r.render(this.scene, this.external.camera);
      this.scene.fog = fogSaved;
      return;
    }
    r.setScissorTest(false);
    r.clear();
    r.setScissorTest(true);
    const fog = this.scene.fog;
    for (const pane of this.panes) {
      const camera = this.placeCamera(pane);
      const x = Math.round(pane.x),
        y = Math.round(H - pane.y - pane.h),
        w = Math.round(pane.w),
        h = Math.round(pane.h);
      r.setViewport(x, y, w, h);
      r.setScissor(x, y, w, h);
      // Seen from above the haze would wash the whole lawn out.
      this.scene.fog = pane.id === "top" || this.kind === "diorama" ? null : fog;
      r.render(this.scene, camera);
    }
    this.scene.fog = fog;
  };
}

export { SUB };
