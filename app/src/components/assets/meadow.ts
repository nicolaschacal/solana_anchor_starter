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

function createTerrainTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  let seed = 90210;
  const rand = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  ctx.fillStyle = "#6f963f";
  ctx.fillRect(0, 0, 512, 512);

  // Broad tonal variation: stylized, not photorealistic.
  for (let i = 0; i < 90; i++) {
    const x = rand() * 512, y = rand() * 512;
    const r = 22 + rand() * 74;
    ctx.beginPath();
    const points = 5 + Math.floor(rand() * 4);
    for (let p = 0; p < points; p++) {
      const a = (p / points) * Math.PI * 2;
      const rr = r * (0.65 + rand() * 0.45);
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (p === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = rand() > 0.5 ? "rgba(139,177,72,.18)" : "rgba(50,99,47,.14)";
    ctx.fill();
  }

  // Sparse dirt islands mixed into the grass material.
  for (let i = 0; i < 12; i++) {
    const x = rand() * 512, y = rand() * 512;
    const rx = 18 + rand() * 42, ry = 10 + rand() * 28;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand() * Math.PI);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(124,95,55,.28)";
    ctx.fill();
    ctx.restore();
  }

  // Small angular grass flecks break the flatness without adding geometry.
  ctx.lineCap = "round";
  for (let i = 0; i < 320; i++) {
    const x = rand() * 512, y = rand() * 512;
    const len = 2 + rand() * 5;
    ctx.strokeStyle = rand() > 0.5 ? "rgba(177,208,90,.32)" : "rgba(37,82,39,.28)";
    ctx.lineWidth = 1 + rand() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 2, y - len);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  texture.needsUpdate = true;
  return texture;
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

  // One continuous low-poly terrain. GLB tiles are intentionally NOT used as
  // ground: Meshy's pieces have thickness/irregular borders and cannot tessellate.
  const terrainGeometry = track(new THREE.PlaneGeometry(120, 120, 20, 20));
  const terrainPositions = terrainGeometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < terrainPositions.count; i++) {
    const x = terrainPositions.getX(i);
    const y = terrainPositions.getY(i);
    const distance = Math.hypot(x, y);
    // Flat playable clearing; gentle relief starts far away.
    const relief =
      distance <= 10
        ? 0
        : (Math.sin(x * 0.14) + Math.cos(y * 0.12)) *
          Math.min(0.7, (distance - 10) * 0.018);
    terrainPositions.setZ(i, relief);
  }
  terrainGeometry.computeVertexNormals();
  const terrainTexture = track(createTerrainTexture());
  const terrainMaterial = track(
    new THREE.MeshStandardMaterial({
      map: terrainTexture,
      color: 0xffffff,
      roughness: 0.96,
      metalness: 0,
      flatShading: true,
    }),
  );

  // Large-scale color variation prevents the repeated texture from reading as a grid.
  terrainMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vTerrainWorld;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
vTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vTerrainWorld;`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
float macroA = sin(vTerrainWorld.x * 0.12) * cos(vTerrainWorld.z * 0.10);
float macroB = sin((vTerrainWorld.x + vTerrainWorld.z) * 0.045);
float macro = macroA * 0.055 + macroB * 0.035;
diffuseColor.rgb *= 1.0 + macro;`,
      );
  };
  terrainMaterial.customProgramCacheKey = () => "rebyters-terrain-v2";

  const floor = new THREE.Mesh(terrainGeometry, terrainMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
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
  shadow.position.set(0, 0.025, 0.1);
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
    // Only actual props are loaded. This also removes three unnecessary GLB
    // downloads from mobile (plain/detail/dirt).
    const keys = (mobile
      ? ["mountains", "tree", "pine", "bush", "rocks"]
      : ["mountains", "tree", "pine", "bush", "rocks", "stump", "log", "mushrooms"]) as AssetKey[];
    const a: Partial<Record<AssetKey, THREE.Group | null>> = {};
    for (const k of keys) {
      a[k] = await loadAsset(k);
      if (disposed) return;
    }

    // Mountains live on the horizon, not directly behind the companion.
    if (a.mountains) {
      const m1 = fit(a.mountains.clone(true), mobile ? 8 : 10);
      m1.position.set(-11, -0.3, -32);
      m1.rotation.y = 0.18;
      group.add(m1);
      const m2 = fit(a.mountains.clone(true), mobile ? 7 : 9);
      m2.position.set(11, -0.4, -38);
      m2.rotation.y = Math.PI * 0.82;
      group.add(m2);
    }
    const tall: [THREE.Group | null | undefined, number, number, number, number][] = mobile
      ? [[a.tree, -5.8, -7.2, 5.2, 0.15], [a.pine, 5.9, -8.0, 5.8, -0.2]]
      : [[a.tree, -6, -7, 5.8, 0.15], [a.pine, 6, -8, 6.4, -0.2], [a.pine, -8, -3, 5.2, 0.25], [a.tree, 8, -3.5, 5.5, -0.25]];
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
    groundY: 0.04,
    update,
    dispose() {
      disposed = true;
      group.removeFromParent();
      own.forEach((resource) => resource.dispose());
    },
  };
}
