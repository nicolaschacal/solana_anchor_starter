import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "meshoptimizer";
import type { WorldPeriod } from "../../hooks/useWorldClock";

const palettes = {
  Night: { sky: 0x101e42, ground: 0x244539, grass: 0x41614b, light: 0xa9c5ff, intensity: 1.4 },
  Morning: { sky: 0x9bbfcb, ground: 0x607b40, grass: 0x92ab58, light: 0xffe4ba, intensity: 2.4 },
  Day: { sky: 0x83c4e3, ground: 0x5c843c, grass: 0x95b953, light: 0xfff2d5, intensity: 2.6 },
  Evening: { sky: 0x696886, ground: 0x4c6240, grass: 0x818453, light: 0xffc191, intensity: 2 },
};
const moteColors = { Night: 0xbcd4ff, Morning: 0xfff0cf, Day: 0xffffff, Evening: 0xffd9b0 };

const ENV = "/assets/environment/";
const files = {
  plain: "grass-plain.glb", detail: "grass-tile.glb", dirt: "dirt-transition.glb",
  mountains: "distant-mountains.glb", pine: "pine-tree.glb", tree: "deciduous-tree.glb",
  bush: "berry-bush.glb", rocks: "mossy-rocks.glb", stump: "tree-stump.glb",
  log: "hollow-log.glb", mushrooms: "red-mushrooms.glb",
} as const;
type AssetKey = keyof typeof files;

// ---- Shared asset cache -----------------------------------------------------
// The login scene, the creature scene and every day/night change reuse the same
// parsed GLBs: each file is downloaded, decoded and uploaded once per page.
// Cached geometry/materials/textures are shared by all clones and are therefore
// never disposed by a scene; only resources created in meadow() are.
let sharedLoader: GLTFLoader | null = null;
const assetCache = new Map<AssetKey, Promise<THREE.Group | null>>();

function loadAsset(key: AssetKey): Promise<THREE.Group | null> {
  let pending = assetCache.get(key);
  if (!pending) {
    sharedLoader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    pending = sharedLoader
      .loadAsync(ENV + files[key])
      .then((gltf) => {
        if (key === "tree" || key === "pine" || key === "bush") addWind(gltf.scene, windStrength[key]);
        return gltf.scene;
      })
      .catch((error) => {
        console.warn("[Rebyters] env", files[key], error);
        assetCache.delete(key); // allow a retry on the next scene
        return null;
      });
    assetCache.set(key, pending);
  }
  return pending;
}

// ---- Wind -------------------------------------------------------------------
// Foliage bends in the vertex shader: displacement grows with height above the
// model's base, so trunks stay planted while crowns sway. It costs no CPU work
// and no extra draw calls. One uniform drives every patched material.
const reducedMotion =
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const wind = { time: { value: 0 }, gain: { value: reducedMotion ? 0.3 : 1 } };
const windStrength = { tree: 0.035, pine: 0.028, bush: 0.045 } as const;

function addWind(root: THREE.Object3D, strength: number) {
  const patched = new Set<THREE.Material>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || patched.has(mesh.material)) return;
    const material = mesh.material as THREE.MeshStandardMaterial;
    mesh.geometry.computeBoundingBox();
    // Decoded attribute space (quantized models are decoded to roughly -1..1).
    const base = mesh.geometry.boundingBox!.min.y;
    const span = Math.max(mesh.geometry.boundingBox!.max.y - base, 1e-4);
    patched.add(material);
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = wind.time;
      shader.uniforms.uGain = wind.gain;
      shader.uniforms.uBase = { value: base };
      shader.uniforms.uSpan = { value: span };
      shader.uniforms.uAmp = { value: span * strength };
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
uniform float uTime; uniform float uGain; uniform float uBase; uniform float uSpan; uniform float uAmp;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
float windH = clamp((position.y - uBase) / uSpan, 0.0, 1.0);
windH *= windH;
float windPhase = modelMatrix[3].x * 0.7 + modelMatrix[3].z * 0.9;
float gust = sin(uTime * 0.9 + windPhase + position.x * 1.5 + position.z * 1.2);
float flutter = sin(uTime * 2.3 + windPhase * 1.7 + position.y * 3.0 + position.x * 4.0) * 0.25;
transformed.x += (gust + flutter) * windH * uAmp * uGain;
transformed.z += cos(uTime * 0.7 + windPhase) * windH * uAmp * 0.5 * uGain;`,
        );
    };
    material.customProgramCacheKey = () => "rebyters-wind";
    material.needsUpdate = true;
  });
}

// ---- Helpers ----------------------------------------------------------------
function fit(o: THREE.Object3D, height: number) {
  o.updateMatrixWorld(true);
  let b = new THREE.Box3().setFromObject(o);
  const s = b.getSize(new THREE.Vector3());
  o.scale.setScalar(height / Math.max(s.y, 0.001));
  o.updateMatrixWorld(true);
  b = new THREE.Box3().setFromObject(o);
  const c = b.getCenter(new THREE.Vector3());
  o.position.set(-c.x, -b.min.y, -c.z);
  return o;
}
function fitGround(o: THREE.Object3D, width: number) {
  o.updateMatrixWorld(true);
  let b = new THREE.Box3().setFromObject(o);
  const s = b.getSize(new THREE.Vector3());
  o.scale.setScalar(width / Math.max(s.x, s.z, 0.001));
  o.updateMatrixWorld(true);
  b = new THREE.Box3().setFromObject(o);
  const c = b.getCenter(new THREE.Vector3());
  o.position.set(-c.x, -b.min.y, -c.z);
  return o;
}
function put(src: THREE.Object3D | null, parent: THREE.Group, x: number, z: number, h: number, r = 0) {
  if (!src) return null;
  const o = fit(src.clone(true), h);
  o.position.x += x;
  o.position.z += z;
  o.rotation.y = r;
  parent.add(o);
  return o;
}

export function meadow(scene: THREE.Scene, period: WorldPeriod) {
  const colors = palettes[period];
  const group = new THREE.Group();
  scene.add(group);
  scene.background = new THREE.Color(colors.sky);
  scene.fog = new THREE.Fog(colors.sky, 18, 50);
  // Resources created here (and only these) are released in dispose().
  const own: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(resource: T) => (own.push(resource), resource);

  const floor = new THREE.Mesh(
    track(new THREE.PlaneGeometry(120, 120)),
    track(new THREE.MeshStandardMaterial({ color: colors.ground, roughness: 1 })),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.04;
  group.add(floor);

  let seed = 12345;
  const rand = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const orb = new THREE.Mesh(
    track(new THREE.SphereGeometry(period === "Night" ? 0.65 : 1, 16, 10)),
    track(new THREE.MeshBasicMaterial({ color: period === "Night" ? 0xe2eeff : 0xffe3af, fog: false })),
  );
  orb.position.set(-3, 6, -28);
  group.add(orb);
  if (period === "Night") {
    const p: number[] = [];
    for (let i = 0; i < 70; i++) {
      const a = rand() * Math.PI * 2;
      p.push(Math.cos(a) * 35, 4 + rand() * 14, Math.sin(a) * 35);
    }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    group.add(new THREE.Points(g, track(new THREE.PointsMaterial({ color: 0xd4e6ff, size: 0.085, fog: false }))));
  }

  const blob = document.createElement("canvas");
  blob.width = blob.height = 64;
  const ctx = blob.getContext("2d")!;
  const grad = ctx.createRadialGradient(32, 32, 6, 32, 32, 32);
  grad.addColorStop(0, "rgba(3,10,7,.72)");
  grad.addColorStop(0.65, "rgba(3,10,7,.2)");
  grad.addColorStop(1, "rgba(3,10,7,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const shadow = new THREE.Mesh(
    track(new THREE.PlaneGeometry(2.7, 1.7)),
    track(new THREE.MeshBasicMaterial({ map: track(new THREE.CanvasTexture(blob)), transparent: true, depthWrite: false })),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, 0.19, 0.1);
  group.add(shadow);

  const mobile = matchMedia("(pointer: coarse)").matches || innerWidth <= 700;
  let disposed = false;

  // Drifting pollen/dust: a few soft points carried by the same breeze. They make
  // the air visibly move even where the foliage barely sways. Hidden when the
  // visitor prefers reduced motion.
  const moteCount = reducedMotion ? 0 : mobile ? 22 : 46;
  const moteBox = { x: 9, yMin: 0.35, yMax: 3.6, zMin: -6.5, zMax: 5 };
  const motePos = new Float32Array(moteCount * 3);
  const moteSeed: number[] = [];
  for (let i = 0; i < moteCount; i++) {
    motePos[i * 3] = (rand() * 2 - 1) * moteBox.x;
    motePos[i * 3 + 1] = moteBox.yMin + rand() * (moteBox.yMax - moteBox.yMin);
    motePos[i * 3 + 2] = moteBox.zMin + rand() * (moteBox.zMax - moteBox.zMin);
    moteSeed.push(rand() * Math.PI * 2);
  }
  let motes: THREE.Points | null = null;
  if (moteCount) {
    const dot = document.createElement("canvas");
    dot.width = dot.height = 32;
    const dctx = dot.getContext("2d")!;
    const dgrad = dctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    dgrad.addColorStop(0, "rgba(255,255,255,1)");
    dgrad.addColorStop(1, "rgba(255,255,255,0)");
    dctx.fillStyle = dgrad;
    dctx.fillRect(0, 0, 32, 32);
    const geometry = track(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
    motes = new THREE.Points(
      geometry,
      track(
        new THREE.PointsMaterial({
          color: moteColors[period], size: 0.075, map: track(new THREE.CanvasTexture(dot)),
          transparent: true, opacity: period === "Night" ? 0.5 : 0.6, depthWrite: false,
        }),
      ),
    );
    motes.frustumCulled = false;
    group.add(motes);
  }

  void (async () => {
    const keys = (mobile
      ? ["plain", "mountains", "tree", "pine", "bush", "detail", "dirt", "rocks"]
      : ["plain", "mountains", "tree", "pine", "bush", "detail", "dirt", "rocks", "stump", "log", "mushrooms"]) as AssetKey[];
    const a: Partial<Record<AssetKey, THREE.Group | null>> = {};
    // Sequential loading is deliberate: stable on iOS and visually progressive.
    for (const k of keys) {
      a[k] = await loadAsset(k);
      if (disposed) return;
    }
    const plain = a.plain;
    if (plain) {
      const coords = mobile
        ? [[-3.8, -3.8], [0, -3.8], [3.8, -3.8], [-3.8, 0], [0, 0], [3.8, 0], [-3.8, 3.8], [0, 3.8], [3.8, 3.8]]
        : [[-7.6, -3.8], [-3.8, -3.8], [0, -3.8], [3.8, -3.8], [7.6, -3.8], [-7.6, 0], [-3.8, 0], [0, 0], [3.8, 0], [7.6, 0], [-7.6, 3.8], [-3.8, 3.8], [0, 3.8], [3.8, 3.8], [7.6, 3.8]];
      coords.forEach(([x, z], i) => {
        const t = fitGround(plain.clone(true), 4.05);
        t.position.set(x, -0.02, z);
        t.rotation.y = (i % 4) * Math.PI / 2;
        group.add(t);
      });
    }
    // One detailed tile and one dirt transition break repetition without clutter.
    if (a.detail) {
      const t = fitGround(a.detail.clone(true), 4.2);
      t.position.set(-3.7, -0.012, 2.8);
      t.rotation.y = Math.PI / 2;
      group.add(t);
    }
    if (a.dirt) {
      const t = fitGround(a.dirt.clone(true), 4.2);
      t.position.set(3.6, -0.01, 2.9);
      t.rotation.y = -Math.PI / 2;
      group.add(t);
    }
    // Mountains are backdrop only; two instances create depth with a tiny asset budget.
    if (a.mountains) {
      const m1 = fit(a.mountains.clone(true), mobile ? 6.5 : 8);
      m1.position.set(-7, 0, -15);
      group.add(m1);
      if (!mobile) {
        const m2 = fit(a.mountains.clone(true), 7);
        m2.position.set(7, 0, -17);
        m2.rotation.y = Math.PI;
        group.add(m2);
      }
    }
    const tall: [THREE.Group | null | undefined, number, number, number, number][] = mobile
      ? [[a.tree, -5, -5.2, 5.5, 0.15], [a.pine, 5.1, -5.8, 6.2, -0.2]]
      : [[a.tree, -5, -5.2, 6, 0.15], [a.pine, 5.2, -5.8, 6.8, -0.2], [a.pine, -7, -1, 5.5, 0.25], [a.tree, 7, -1.5, 5.8, -0.25]];
    tall.forEach(([src, x, z, h, r]) => put(src ?? null, group, x, z, h, r));
    const bushes = mobile ? [[-3.8, -2.5], [3.9, -2.8]] : [[-3.8, -2.5], [3.9, -2.8], [-4.5, 2.4], [4.6, 2.1]];
    bushes.forEach(([x, z], i) => put(a.bush ?? null, group, x, z, 1.05, i * 0.7));
    put(a.rocks ?? null, group, -2.9, 1.8, 0.65, 0.3);
    if (!mobile) {
      put(a.stump ?? null, group, -4, 0.2, 0.85, 0.2);
      put(a.log ?? null, group, 4.2, 0.3, 0.75, -0.5);
      put(a.mushrooms ?? null, group, -2, -1.8, 0.4, 0.15);
    }
  })();

  // Wind is driven by the caller's existing render loop: no second RAF.
  let lastTime = 0;
  const update = (time: number) => {
    const dt = lastTime ? Math.min(time - lastTime, 0.1) : 0;
    lastTime = time;
    wind.time.value = time;
    if (!motes) return;
    for (let i = 0; i < moteCount; i++) {
      const s = moteSeed[i];
      let x = motePos[i * 3] + (0.3 + Math.sin(time * 0.45 + s) * 0.12) * dt;
      if (x > moteBox.x) x = -moteBox.x;
      motePos[i * 3] = x;
      motePos[i * 3 + 1] += Math.sin(time * 0.8 + s * 3) * 0.1 * dt;
      motePos[i * 3 + 2] += Math.cos(time * 0.55 + s * 2) * 0.08 * dt;
    }
    (motes.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  };
  return {
    colors,
    groundY: 0.18,
    update,
    dispose() {
      disposed = true;
      group.removeFromParent();
      own.forEach((resource) => resource.dispose());
    },
  };
}
