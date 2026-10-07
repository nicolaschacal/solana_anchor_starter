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
import { meadowTexture } from "../../assets/habitat-materials";
import type { WorldPeriod } from "../../../hooks/useWorldClock";
import type { AssetModel } from "../../../lib/assets/rig";
import {
  BANK_Y,
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
export type SceneData = {
  version: 1;
  period: WorldPeriod;
  tiles: TileData;
  props: (PropData & { id: number })[];
  creature: { x: number; z: number };
  lake: boolean;
  trail: boolean;
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
  { key: "grass", label: "Mata de pasto", h: 0.35 },
  { key: "wildflowers", label: "Flores silvestres", h: 0.5 },
  { key: "reeds", label: "Juncos", h: 1.1 },
  { key: "lantern", label: "Farol encantado", h: 1 },
];

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

type Callbacks = {
  onLayout?: (panes: Pane[]) => void;
  onError?: (message: string) => void;
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
  showLake = true;
  showTrail = true;
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
    const material = new THREE.MeshStandardMaterial({ map: meadowTexture(), roughness: 0.96, metalness: 0 });
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

  /** Builds the real meadow. With saved data the saved props replace the default woodland. */
  async init(saved: SceneData | null) {
    if (saved) this.applyData(saved);
    this.buildEnv(!saved);
    await this.env.ready;
    if (this.disposed) return;
    if (saved) await this.spawnAll(saved.props);
    else this.adoptDefaultProps();
    this.refreshTerrain();
    this.layout();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.tick);
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
    this.mixer?.stopAllAction();
    this.renderer.dispose();
  }

  private buildEnv(defaultProps: boolean) {
    this.env?.dispose();
    this.entries.forEach((e) => (e.prop = null));
    this.env = meadow(this.scene, this.period, {
      grassExclusions: [{ x: 0, z: CREATURE_Z, radius: 1.35 }],
      props: defaultProps,
    });
    this.applyLights();
    this.instanced = [this.env.grass, ...this.env.flowers].map((mesh) => {
      mesh.frustumCulled = false;
      return { mesh, base: Float32Array.from(mesh.instanceMatrix.array) };
    });
    this.lakeMesh?.removeFromParent();
    this.bankMesh?.removeFromParent();
    this.lakeMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.env.waterMaterial);
    this.lakeMesh.renderOrder = 2;
    this.lakeMesh.frustumCulled = false;
    this.bankMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.env.bankMaterial);
    this.bankMesh.receiveShadow = true;
    this.bankMesh.frustumCulled = false;
    this.scene.add(this.bankMesh, this.lakeMesh);
    this.env.lake.visible = this.showLake;
    this.env.bank.visible = this.showLake;
    this.env.path.visible = this.showTrail;
    this.placeCreature();
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
  async addProp(key: AssetKey, x: number, z: number) {
    const item = PROP_CATALOG.find((p) => p.key === key);
    const tile = TileMap.tileOf(x, z);
    return this.spawnEntry({ key, x: OX + tile.i, z: OZ + tile.j, h: item?.h ?? 1, r: Math.random() * Math.PI * 2 });
  }
  removeProp(entry: PropEntry) {
    if (entry.prop) this.env.removeProp(entry.prop);
    this.entries = this.entries.filter((e) => e !== entry);
    if (this.selected === entry) this.select(null);
  }
  moveProp(entry: PropEntry, x: number, z: number) {
    const tile = TileMap.tileOf(x, z);
    entry.x = OX + tile.i;
    entry.z = OZ + tile.j;
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
    this.updateRing();
  }
  private updateRing() {
    const e = this.selected;
    this.ring.visible = !!e;
    if (!e) return;
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
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const framing = 2 / Math.max(size.x, size.y, size.z, 0.001);
    const scale = framing * CREATURE_SCALE;
    this.stage.scale.setScalar(scale);
    this.stageBase.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    this.creatureSpan = size.x * framing;
    this.creatureRoot = root;
    const normalize = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const idle = model.clips.find((c) => clipNames.includes(normalize(c.name)));
    this.mixer = new THREE.AnimationMixer(root);
    if (idle) this.mixer.clipAction(idle).play();
    this.placeCreature();
    for (const v of Object.values(this.views)) v.custom = false;
    this.layout();
  }
  private placeCreature() {
    const y = this.map.heightAt(this.creature.x, this.creature.z) + (this.env?.groundY ?? 0.04);
    this.stage.position.set(
      this.creature.x + this.stageBase.x,
      y + this.stageBase.y,
      this.creature.z + this.stageBase.z,
    );
    this.env?.setCompanionShadowPosition(this.creature.x, this.creature.z);
    this.companionRim.position.set(this.creature.x - 0.15, y + 2.45, this.creature.z - 2.15);
    this.companionRimTarget.position.set(this.creature.x, y + 1.0, this.creature.z);
  }
  moveCreature(x: number, z: number) {
    const tile = TileMap.tileOf(x, z);
    if (this.map.water[TileMap.index(tile.i, tile.j)]) return false;
    this.creature = { x: OX + tile.i, z: OZ + tile.j };
    this.placeCreature();
    this.applyMasks();
    this.env.markShadowsDirty();
    return true;
  }

  // ---- Terrain editing -------------------------------------------------------

  brushTiles(i: number, j: number, size: number) {
    const radius = size === 1 ? 0 : size === 3 ? 1.5 : 2.5;
    const reach = Math.ceil(radius);
    const tiles: [number, number][] = [];
    for (let dj = -reach; dj <= reach; dj++)
      for (let di = -reach; di <= reach; di++)
        if (di * di + dj * dj <= radius * radius + 0.01 && TileMap.inBounds(i + di, j + dj))
          tiles.push([i + di, j + dj]);
    return tiles;
  }
  private creatureTile() {
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
    for (const [i, j] of tiles) {
      const k = TileMap.index(i, j);
      if (visited.has(k)) continue;
      visited.add(k);
      if (add) {
        if (this.map.water[k] || (i === home.i && j === home.j)) continue;
        this.map.water[k] = 1;
        this.map.level[k] = 0;
        changed = true;
      } else if (this.map.water[k]) {
        this.map.water[k] = 0;
        changed = true;
      }
    }
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
    for (const entry of [...this.entries]) {
      const tile = TileMap.tileOf(entry.x, entry.z);
      if (this.map.water[TileMap.index(tile.i, tile.j)] && entry.key !== "reeds" && entry.key !== "shoreRocks")
        this.removeProp(entry);
    }
    this.refreshTerrain();
  }
  refreshTerrain() {
    this.map.refresh();
    const swap = (mesh: THREE.Mesh | THREE.LineSegments, geometry: THREE.BufferGeometry | null) => {
      mesh.geometry.dispose();
      mesh.geometry = geometry ?? new THREE.BufferGeometry();
      mesh.visible = !!geometry;
    };
    swap(this.overlay, buildOverlayGeometry(this.map));
    if (this.lakeMesh && this.bankMesh) {
      swap(this.lakeMesh, buildContourGeometry(this.map, 0.5, WATER_Y));
      swap(this.bankMesh, buildContourGeometry(this.map, 0.3, BANK_Y));
    }
    this.gridLines.geometry.dispose();
    this.gridLines.geometry = this.showGrid ? buildGridGeometry(this.map) : new THREE.BufferGeometry();
    this.applyMasks();
    for (const entry of this.entries) this.applyEntry(entry);
    this.placeCreature();
    this.updateRing();
    this.env.markShadowsDirty();
  }
  setGrid(visible: boolean) {
    this.showGrid = visible;
    this.gridLines.geometry.dispose();
    this.gridLines.geometry = visible ? buildGridGeometry(this.map) : new THREE.BufferGeometry();
  }
  setOriginals(options: { lake?: boolean; trail?: boolean }) {
    if (options.lake !== undefined) this.showLake = options.lake;
    if (options.trail !== undefined) this.showTrail = options.trail;
    this.env.lake.visible = this.showLake;
    this.env.bank.visible = this.showLake;
    this.env.path.visible = this.showTrail;
    this.env.markShadowsDirty();
  }

  /** Grass blades and flowers follow raised ground and disappear under water, paths and bare slopes. */
  private applyMasks() {
    const modified = this.map.isModified();
    const mix = [0, 0, 0];
    for (const { mesh, base } of this.instanced) {
      const out = mesh.instanceMatrix.array as Float32Array;
      out.set(base);
      if (modified)
        for (let k = 0; k < mesh.count; k++) {
          const o = k * 16;
          if (base[o] === 0 && base[o + 2] === 0 && base[o + 5] === 0) continue;
          const x = base[o + 12],
            z = base[o + 14];
          let hide = this.map.waterAt(x, z) > 0.4;
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
      version: 1,
      period: this.period,
      tiles: this.map.serialize(),
      props: this.entries.map(({ id, key, x, z, h, r }) => ({ id, key, x, z, h, r })),
      creature: { ...this.creature },
      lake: this.showLake,
      trail: this.showTrail,
      lighting: { ...this.lighting },
    };
  }
  static isSceneData(data: unknown): data is SceneData {
    const d = data as SceneData;
    return (
      !!d &&
      d.version === 1 &&
      ["Night", "Morning", "Day", "Evening"].includes(d.period) &&
      !!d.tiles &&
      TileMap.validate(d.tiles) &&
      Array.isArray(d.props) &&
      d.props.every(
        (p) =>
          typeof p.key === "string" &&
          [p.x, p.z, p.h, p.r].every((n) => Number.isFinite(n)) &&
          p.h > 0,
      ) &&
      !!d.creature &&
      Number.isFinite(d.creature.x) &&
      Number.isFinite(d.creature.z)
    );
  }
  private applyData(data: SceneData) {
    this.period = data.period;
    this.map.load(data.tiles);
    this.creature = { ...data.creature };
    this.showLake = data.lake !== false;
    this.showTrail = data.trail !== false;
    if (data.lighting) this.lighting = { ...DEFAULT_LIGHTING, ...data.lighting };
  }
  /** Restores a snapshot, keeping props that did not change. */
  async restore(data: SceneData) {
    this.map.load(data.tiles);
    this.creature = { ...data.creature };
    this.showLake = data.lake !== false;
    this.showTrail = data.trail !== false;
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
      this.env.lake.visible = this.showLake;
      this.env.bank.visible = this.showLake;
      this.env.path.visible = this.showTrail;
    }
    this.select(null);
    this.refreshTerrain();
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
  /** The game's own camera framing for the companion, per aspect ratio. */
  private frameDefault(pane: Pane) {
    const v = this.views[pane.id];
    if (pane.id === "top") {
      v.zoom = 1;
      v.target.set(0, 0, OZ + (GZ - 1) / 2);
      return;
    }
    const portrait = pane.id === "mobile";
    const aspect = pane.w / pane.h;
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
  resetView(id: ViewId) {
    this.views[id].custom = false;
    const pane = this.panes.find((p) => p.id === id);
    if (pane) this.frameDefault(pane);
  }
  orbit(id: ViewId, dx: number, dy: number) {
    const v = this.views[id];
    if (id === "top") return;
    v.custom = true;
    v.yaw -= dx * 0.006;
    v.pitch = clamp(v.pitch + dy * 0.005, 0.03, 1.5);
  }
  pan(id: ViewId, dx: number, dy: number, pane: Pane) {
    const v = this.views[id];
    v.custom = true;
    if (id === "top") {
      const unit = (2 * this.topHalf(pane) * 1) / pane.h;
      v.target.x = clamp(v.target.x - dx * unit, OX - 4, OX + GX + 4);
      v.target.z = clamp(v.target.z - dy * unit, OZ - 4, OZ + GZ + 4);
      return;
    }
    const unit = (2 * v.dist * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / pane.h;
    const rx = Math.cos(v.yaw),
      rz = -Math.sin(v.yaw),
      fx = -Math.sin(v.yaw),
      fz = -Math.cos(v.yaw);
    v.target.x = clamp(v.target.x - (rx * dx - fx * dy) * unit, OX - 6, OX + GX + 6);
    v.target.z = clamp(v.target.z - (rz * dx - fz * dy) * unit, OZ - 6, OZ + GZ + 6);
  }
  zoom(id: ViewId, factor: number) {
    const v = this.views[id];
    v.custom = true;
    if (id === "top") v.zoom = clamp(v.zoom / factor, 0.5, 5);
    else v.dist = clamp(v.dist * factor, 1.5, 60);
  }
  private topHalf(pane: Pane) {
    const aspect = pane.w / pane.h;
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
    if (!TileMap.inBounds(i, j)) return null;
    return { x, z, i, j };
  }

  // ---- Frame loop --------------------------------------------------------------

  private tick = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    if (document.hidden || !this.panes.length) return;
    const delta = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    this.mixer?.update(delta);
    this.env.update(now / 1000, fakeUnix(this.period));
    this.syncLightColors();
    if (this.env.consumeShadowUpdate()) this.renderer.shadowMap.needsUpdate = true;
    const r = this.renderer;
    const H = this.host.clientHeight;
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
      this.scene.fog = pane.id === "top" ? null : fog;
      r.render(this.scene, camera);
    }
    this.scene.fog = fog;
  };
}

export { SUB };
