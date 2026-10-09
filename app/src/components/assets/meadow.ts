import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "meshoptimizer";
import { nightBlend } from "./twilight";
import { meadowTexture, grassCarpet, cloudGroup, lakeMaterial, moonTexture } from "./habitat-materials";
import type { WorldPeriod } from "../../hooks/useWorldClock";

const palettes = {
  Night: {
    sky: 0x0b2459,
    horizon: 0x315c91,
    ground: 0x2b4d42,
    grass: 0x496a54,
    light: 0xa9cfff,
    intensity: 1.35,
  },
  Morning: {
    sky: 0x80b9df,
    horizon: 0xffdfbd,
    ground: 0x607b40,
    grass: 0x92ab58,
    light: 0xffe2b5,
    intensity: 1.72,
  },
  Day: {
    sky: 0x559fda,
    horizon: 0xd2edf0,
    ground: 0x5c843c,
    grass: 0x95b953,
    light: 0xffefd5,
    intensity: 1.62,
  },
  Evening: {
    sky: 0x656fa6,
    horizon: 0xf1bc9d,
    ground: 0x4c6240,
    grass: 0x818453,
    light: 0xffc58f,
    intensity: 1.48,
  },
};
const moteColors = {
  Night: 0xffeb99,
  Morning: 0xfff0cf,
  Day: 0xffffff,
  Evening: 0xffd9b0,
};

// Global brightness lift for ambient and fill light. 1 = the previous look; raise
// it to brighten every prop and the ground, lower it for a moodier scene.
const LIGHT_LIFT = 1.45;

const ENV = "/assets/environment/";
const files = {
  mountains: "distant-mountains.glb",
  pine: "pine-tree.glb",
  tree: "deciduous-tree.glb",
  bush: "berry-bush.glb",
  rocks: "mossy-rocks.glb",
  stump: "tree-stump.glb",
  log: "hollow-log.glb",
  mushrooms: "red-mushrooms.glb",
  grass: "grass_clump_mobile.glb",
  wildflowers: "wildflowers_mobile.glb",
  reeds: "water_reeds_mobile.glb",
} as const;
// Optional props: not part of the default composition and never preloaded by the
// game. The habitat editor loads them on demand through spawn().
const extraFiles = {
  hero: "hero_tree_mobile.glb",
  lantern: "enchanted_lantern_mobile.glb",
  shoreRocks: "shore_rocks_strip_mobile.glb",
  vending: "vending-machine.glb",
  busStop: "bus-stop.glb",
} as const;
const allFiles = { ...files, ...extraFiles } as const;
type BaseKey = keyof typeof files;
export type AssetKey = keyof typeof allFiles;

// A prop placed in the scene, with the contact shadow that grounds it.
export type PlacedProp = {
  key: AssetKey;
  node: THREE.Object3D;
  contact: THREE.Mesh | null;
  x: number;
  z: number;
  h: number;
  r: number;
};

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
      .loadAsync(ENV + allFiles[key])
      .then((gltf) => {
        if (key === "tree" || key === "pine" || key === "bush" || key === "hero")
          addWind(gltf.scene, windStrength[key]);
        return gltf.scene;
      })
      .catch((error) => {
        console.warn("[Rebyters] env", allFiles[key], error);
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
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;
const wind = { time: { value: 0 }, gain: { value: reducedMotion ? 0.3 : 1 } };
const windStrength = { tree: 0.035, pine: 0.028, bush: 0.045, hero: 0.03 } as const;

function addWind(root: THREE.Object3D, strength: number) {
  const patched = new Set<THREE.Material>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (
      !mesh.isMesh ||
      Array.isArray(mesh.material) ||
      patched.has(mesh.material)
    )
      return;
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
// Normalize inside a separate pivot. Rotating an imported Meshy root after
// recentering it otherwise rotates its original offset back out of the frame.
function normalize(o: THREE.Object3D, extent: number, ground = false) {
  o.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(o);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale =
    extent / Math.max(ground ? Math.max(size.x, size.z) : size.y, 0.001);
  const pivot = new THREE.Group();
  o.scale.multiplyScalar(scale);
  o.position.multiplyScalar(scale);
  o.position.add(
    new THREE.Vector3(-center.x, -bounds.min.y, -center.z).multiplyScalar(
      scale,
    ),
  );
  pivot.add(o);
  return pivot;
}
function fit(o: THREE.Object3D, height: number) {
  return normalize(o, height);
}
function put(
  src: THREE.Object3D | null,
  parent: THREE.Group,
  x: number,
  z: number,
  h: number,
  r = 0,
) {
  if (!src) return null;
  const o = fit(src.clone(true), h);
  o.position.x += x;
  o.position.z += z;
  o.rotation.y = r;
  parent.add(o);
  return o;
}

export function meadow(
  scene: THREE.Scene,
  period: WorldPeriod,
  options: {
    grassExclusions?: { x: number; z: number; radius: number }[];
    // false skips the default woodland and props (the habitat editor places its own).
    props?: boolean;
    /** Distant mountains. Dioramas turn them off. */
    scenery?: boolean;
    /** false hides the painted sun, moon, stars and clouds (a caller draws its own). */
    skyBodies?: boolean;
    /** Height range (sin of elevation) over which the sky goes from horizon to zenith colour. */
    skyRange?: [number, number];
  } = {},
) {
  const colors = {
    ...palettes[period],
    // Lower ambient/fill levels preserve facet shading and give the scene
    // cinematic depth instead of washing every surface with equal light.
    ambientIntensity:
      (period === "Night" ? 0.72 : period === "Evening" ? 0.82 : 0.94) * LIGHT_LIFT,
    fillIntensity:
      (period === "Night" ? 0.38 : period === "Evening" ? 0.30 : 0.26) * LIGHT_LIFT,
    moonIntensity: period === "Night" ? 0.52 * LIGHT_LIFT : 0,
    rimIntensity: period === "Night" ? 0.42 : period === "Evening" ? 0.18 : 0.08,
  };
  const group = new THREE.Group();
  let shadowsDirty = true;
  scene.add(group);
  const mobile = matchMedia("(pointer: coarse)").matches || innerWidth <= 700;
  scene.background = new THREE.Color(colors.sky);
  // Cool distant haze preserves mountain separation even at sunset.
  const haze =
    period === "Night" ? 0x315888 : period === "Evening" ? 0x8896b2 : 0xb2d4e2;
  scene.fog = new THREE.Fog(
    haze,
    period === "Night" ? 28 : 40,
    period === "Night" ? 95 : 120,
  );
  // Resources created here (and only these) are released in dispose().
  const own: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(resource: T) => (
    own.push(resource),
    resource
  );

  // World-space gradient sky, independent of lighting and below all scenery.
  const sky = new THREE.Mesh(
    track(new THREE.SphereGeometry(1, 24, 16)),
    track(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        toneMapped: false,
        uniforms: {
          topColor: { value: new THREE.Color(colors.sky) },
          horizonColor: { value: new THREE.Color(colors.horizon) },
          range: { value: new THREE.Vector2(...(options.skyRange ?? [-0.04, 0.48])) },
        },
        vertexShader: `varying vec3 vSkyDirection;
        void main() {
          vSkyDirection = position;
          // Remove camera translation and pin depth inside the far plane.
          // Portrait framing cannot clip holes in this background.
          vec3 direction = mat3(viewMatrix) * position;
          gl_Position = projectionMatrix * vec4(direction, 1.0);
          gl_Position.z = gl_Position.w * 0.9999;
        }`,
        fragmentShader: `uniform vec3 topColor; uniform vec3 horizonColor; uniform vec2 range;
        varying vec3 vSkyDirection;
        void main() {
          float height = normalize(vSkyDirection).y;
          float blend = smoothstep(range.x, range.y, height);
          gl_FragColor = vec4(mix(horizonColor, topColor, blend), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      }),
    ),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  group.add(sky);

  // One continuous low-poly terrain. GLB tiles are intentionally NOT used as
  // ground: Meshy's pieces have thickness/irregular borders and cannot tessellate.
  const terrainGeometry = track(new THREE.PlaneGeometry(120, 120, 20, 20));
  const terrainPositions = terrainGeometry.attributes
    .position as THREE.BufferAttribute;
  for (let i = 0; i < terrainPositions.count; i++) {
    const x = terrainPositions.getX(i);
    const y = terrainPositions.getY(i);
    const distance = Math.hypot(x, y);
    // Flat playable clearing; gentle relief starts far away.
    const relief =
      distance <= 28
        ? 0
        : (Math.sin(x * 0.14) + Math.cos(y * 0.12)) *
          Math.min(0.7, (distance - 28) * 0.018);
    terrainPositions.setZ(i, relief);
  }
  terrainGeometry.computeVertexNormals();
  const terrainTexture = meadowTexture();
  const terrainMaterial = track(
    new THREE.MeshStandardMaterial({
      map: terrainTexture,
      color: 0xffffff,
      roughness: 0.96,
      metalness: 0,
      flatShading: false,
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
  floor.receiveShadow = true;
  group.add(floor);

  let seed = 12345;
  const rand = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const skyGroup = new THREE.Group();
  skyGroup.visible = options.skyBodies !== false;
  group.add(skyGroup);
  const orb = new THREE.Mesh(
    track(new THREE.SphereGeometry(period === "Night" ? 0.8 : 1.04, 24, 16)),
    track(
      new THREE.MeshBasicMaterial({
        color: period === "Night" ? 0xe2eeff : 0xffe3af,
        map: period === "Night" ? moonTexture() : null,
        toneMapped: false,
        transparent: true,
        fog: false,
      }),
    ),
  );
  orb.position.set(
    period === "Evening" ? 2.7 : 4.4,
    period === "Evening" ? 11 : 14,
    -64,
  );
  skyGroup.add(orb);
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = glowCanvas.height = 128;
  const glowContext = glowCanvas.getContext("2d")!;
  const glow = glowContext.createRadialGradient(64, 64, 5, 64, 64, 64);
  glow.addColorStop(0, "rgba(255,255,255,0.28)");
  glow.addColorStop(0.35, "rgba(255,255,255,0.12)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  glowContext.fillStyle = glow;
  glowContext.fillRect(0, 0, 128, 128);
  const halo = new THREE.Sprite(
    track(
      new THREE.SpriteMaterial({
        map: track(new THREE.CanvasTexture(glowCanvas)),
        color: period === "Night" ? 0xb9d3ff : 0xffda9b,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    ),
  );
  halo.position.copy(orb.position);
  halo.scale.setScalar(period === "Night" ? 4.4 : 6.0);
  skyGroup.add(halo);

  const cloudColor =
    period === "Night"
      ? 0x829dcd
      : period === "Evening"
        ? 0xffe4d3
        : period === "Morning"
          ? 0xffead8
          : 0xffffff;
  const clouds: Array<{
    sprite: THREE.Group;
    baseX: number;
    speed: number;
    phase: number;
  }> = [];
  const cloudDefs = [
    [-7.0, 14.6, -64, 2.35, 0.025, 0.2],
    [8.0, 13.2, -66, 1.95, 0.018, 1.6],
    [0.7, 17.0, -72, 2.2, 0.012, 2.7],
  ];
  cloudDefs.forEach(([x, y, z, scale, speed, phase], variant) => {
    const sprite = cloudGroup(own, cloudColor, variant);
    sprite.position.set(x, y, z);
    sprite.scale.set(
      scale * (variant === 1 ? 1.12 : 1),
      scale * (variant === 2 ? 0.78 : 1),
      scale,
    );
    sprite.rotation.z = variant === 0 ? -0.035 : variant === 1 ? 0.025 : 0;
    skyGroup.add(sprite);
    clouds.push({ sprite, baseX: x, speed, phase });
  });
  // Stars are always allocated once and fade in with twilight, behind ridges.
  const starPositions: number[] = [];
  for (let i = 0; i < 85; i++) {
    starPositions.push((rand() - 0.5) * 64, 13 + rand() * 21, -76 - rand() * 3);
  }
  const starGeometry = track(new THREE.BufferGeometry());
  starGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(starPositions, 3),
  );
  const starMaterial = track(
    new THREE.PointsMaterial({
      color: 0xeaf2ff,
      size: 0.17,
      toneMapped: false,
      fog: false,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
    }),
  );
  const stars = new THREE.Points(starGeometry, starMaterial);
  skyGroup.add(stars);
  const moon = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.8, 20, 12)),
    track(
      new THREE.MeshBasicMaterial({
        color: 0xdbe7ff,
        map: moonTexture(),
        toneMapped: false,
        fog: false,
        transparent: true,
        opacity: 0,
      }),
    ),
  );
  moon.position.set(-4.4, 14, -64);
  if (period === "Evening") skyGroup.add(moon);
  // A higher light angle illuminates the lawn; the distant sky disc is visual.
  const lightPosition = new THREE.Vector3(7, 10, -8);

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
    track(
      new THREE.MeshBasicMaterial({
        map: track(new THREE.CanvasTexture(blob)),
        transparent: true,
        depthWrite: false,
      }),
    ),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, 0.025, 0.1);
  // The blob is a contact shadow for the companion, not scenery. Keep it hidden
  // until the creature viewer supplies the companion's actual world position.
  shadow.visible = false;
  group.add(shadow);

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
          color: moteColors[period],
          size: period === "Night" ? 0.065 : 0.045,
          map: track(new THREE.CanvasTexture(dot)),
          transparent: true,
          opacity: period === "Night" ? 0.5 : 0.6,
          depthWrite: false,
        }),
      ),
    );
    motes.frustumCulled = false;
    group.add(motes);
  }

  // A lake and a winding trail lead the eye from the clearing into the valley.
  // The lake is an irregular silhouette, not a rectangular terrain tile.
  const lakeShape = new THREE.Shape();
  lakeShape.moveTo(-7, -2.6);
  lakeShape.bezierCurveTo(-8, -0.5, -4, 2.4, -1.4, 2.7);
  lakeShape.bezierCurveTo(2.5, 3.5, 8, 2.6, 8.8, 0.3);
  lakeShape.bezierCurveTo(9.5, -2.7, 3, -3.1, -0.6, -2.6);
  lakeShape.bezierCurveTo(-3.5, -3.6, -6, -3.4, -7, -2.6);
  const lakeGeometry = track(new THREE.ShapeGeometry(lakeShape, 28));
  // One opaque water surface, with analytic normals and a broken moon reflection.
  const waterMaterial = track(lakeMaterial(wind, colors.sky, colors.light));
  const bank = new THREE.Mesh(
    lakeGeometry,
    track(new THREE.MeshStandardMaterial({ color: 0x64805b, roughness: 1 })),
  );
  bank.rotation.x = -Math.PI / 2;
  bank.position.set(1, 0.035, -13);
  bank.receiveShadow = true;
  bank.scale.set(1.035, 1.045, 1);
  group.add(bank);
  const lake = new THREE.Mesh(lakeGeometry, waterMaterial);
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(1, 0.05, -13);
  group.add(lake);

  const trail = new THREE.Shape();
  trail.moveTo(1.1, 2);
  trail.bezierCurveTo(2.9, 4, 1.6, 5.4, 3.1, 7.4);
  trail.bezierCurveTo(4.5, 8.7, 4.5, 9.2, 4.7, 10);
  trail.lineTo(5.1, 10);
  trail.bezierCurveTo(5, 8.7, 5.3, 8.4, 3.8, 7.1);
  trail.bezierCurveTo(2.5, 5.3, 4.4, 3.5, 2.3, 2);
  trail.closePath();
  const path = new THREE.Mesh(
    track(new THREE.ShapeGeometry(trail, 24)),
    track(new THREE.MeshStandardMaterial({ color: 0xb6a777, roughness: 1 })),
  );
  path.rotation.x = -Math.PI / 2;
  path.position.y = 0.018;
  path.receiveShadow = true;
  group.add(path);

  const carpet = grassCarpet(mobile, wind, track, options.grassExclusions ?? []);
  group.add(carpet.mesh);
  const flowerLocations = carpet.flowers;
  const matrix = new THREE.Object3D();
  const petalGeometry = track(new THREE.SphereGeometry(1, 5, 3));
  const petals = new THREE.InstancedMesh(
    petalGeometry,
    track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 })),
    flowerLocations.length * 5,
  );
  const centers = new THREE.InstancedMesh(
    petalGeometry,
    track(new THREE.MeshStandardMaterial({ color: 0xf7c94b, roughness: 1 })),
    flowerLocations.length,
  );
  flowerLocations.forEach((p, i) => {
    const color = new THREE.Color(i % 3 === 0 ? 0xffc1db : 0xfff4d6);
    for (let k = 0; k < 5; k++) {
      const angle = (k * Math.PI * 2) / 5;
      matrix.position.set(
        p.x + Math.cos(angle) * 0.07,
        p.y,
        p.z + Math.sin(angle) * 0.07,
      );
      matrix.rotation.set(0, -angle, 0);
      matrix.scale.set(0.073, 0.02, 0.042);
      matrix.updateMatrix();
      petals.setMatrixAt(i * 5 + k, matrix.matrix);
      petals.setColorAt(i * 5 + k, color);
    }
    matrix.position.copy(p);
    matrix.scale.set(0.04, 0.025, 0.04);
    matrix.updateMatrix();
    centers.setMatrixAt(i, matrix.matrix);
  });
  petals.instanceMatrix.needsUpdate = centers.instanceMatrix.needsUpdate = true;
  track(petals);
  track(centers);
  group.add(petals, centers);

  // Load all reusable props concurrently. Mobile keeps the same composition;
  // only repeated vegetation and ground-detail density differ.
  const props: PlacedProp[] = [];
  const assets: Partial<Record<AssetKey, THREE.Group | null>> = {};
  const plant = (key: AssetKey, x: number, z: number, h: number, r = 0) => {
    const prop = put(assets[key] ?? null, group, x, z, h, r);
    if (prop && key !== "mountains") {
      const contact = new THREE.Mesh(shadow.geometry, shadow.material);
      contact.position.set(x, 0.022, z);
      contact.rotation.x = -Math.PI / 2;
      contact.scale.set(h * 0.36, h * 0.3, 1);
      group.add(contact);
      props.push({ key, node: prop, contact, x, z, h, r });
    }
    if (prop && key !== "mountains" && z > -15) {
      prop.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
    }
    return prop;
  };
  const ready = (async () => {
    const keys = Object.keys(files) as BaseKey[];
    const loaded = await Promise.all(keys.map(loadAsset));
    if (disposed) return;
    keys.forEach((key, i) => {
      assets[key] = loaded[i];
    });
    // Three overlapping ridgelines, readable through a gentle aerial haze.
    if (options.scenery !== false)
    for (const [x, z, h, r] of [
      [-8, -32, 10, 0.25],
      [7, -28, 8.5, 2.6],
      [0, -43, 12, 0.1],
    ]) {
      const mountain = plant("mountains", x, z, h, r);
      if (mountain) {
        mountain.updateMatrixWorld(true);
        const extent = new THREE.Box3()
          .setFromObject(mountain)
          .getSize(new THREE.Vector3());
        // This asset includes a broad terrain apron. Compress its depth so it
        // stays behind the woodland instead of swallowing the lake and clearing.
        mountain.scale.x = 25 / Math.max(extent.x, 0.001);
        mountain.scale.z = 5 / Math.max(extent.z, 0.001);
      }
      mountain?.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        const tint = (source: THREE.Material) => {
          const material = track(source.clone()) as THREE.MeshStandardMaterial;
          material.color.setHex(
            period === "Night"
              ? z < -35
                ? 0x6389bd
                : 0x456c9d
              : period === "Evening"
                ? z < -35
                  ? 0x8193b6
                  : 0x5b7898
                : z < -35
                  ? 0x86b5ca
                  : 0x6094aa,
          );
          material.map = null;
          material.vertexColors = false;
          material.roughness = 1;
          return material;
        };
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(tint)
          : tint(mesh.material);
      });
    }
    if (options.props !== false) {
    // Far woodland gives the lake a shoreline and connects it to the mountains.
    const forest = mobile ? 14 : 18;
    for (let i = 0; i < forest; i++) {
      const x = -13 + (i * 26) / (forest - 1);
      plant(
        i % 3 === 0 ? "tree" : "pine",
        x,
        -19 - rand() * 5,
        2.8 + rand() * 2.8,
        rand() * 6,
      );
    }
    // Middle ground: keep the foreground broadleaf framing, but remove the
    // two large broadleaf trees from the distant background. Pines remain.
    plant("tree", -3.0, -5.8, 6.6, 0.28);
    plant("pine", 3.3, -7.6, 6.0, -0.35);
    plant("pine", 7.8, -13.5, 4.9, 0.5);
    plant("pine", -3.8, -15.8, 3.6, 0.2);
    // Outer wings fill widescreen without blocking the clear central habitat.
    plant("tree", -10, -5, 7.8, -0.3);
    plant("pine", 10.7, -7, 7.0, 0.4);
    for (const [x, z, h] of [
      [-2.9, -3.2, 1.0],
      [3.2, -4.2, 1.2],
      [-4.8, -7, 1.2],
      [5.2, -8, 0.9],
      [-1.95, 1.5, 0.65],
      [2.05, 1.0, 0.7],
      [-7, 0, 1.5],
      [7.3, -1, 1.3],
    ]) {
      plant("bush", x, z, h, rand() * 6);
    }
    plant("rocks", 2.5, -2.7, 0.6, -0.4);
    plant("rocks", -2.2, 1.4, 0.43, 0.6);
    plant("rocks", 3.4, -9.7, 0.7, 0.4);
    plant("stump", -2.6, -1.6, 0.65, 0.3);
    plant("log", 3.4, -5.2, 0.65, -0.8);
    plant("mushrooms", -1.75, -0.7, 0.28, 0.2);
    plant("mushrooms", 2.25, 0.5, 0.22, -0.3);
    }

    shadowsDirty = true;
  })();

  // Editing API. Props can be added or removed after the first assembly; the
  // game itself never calls these.
  const spawn = async (
    key: AssetKey,
    x: number,
    z: number,
    h: number,
    r = 0,
  ) => {
    await ready;
    if (disposed) return null;
    if (assets[key] === undefined) assets[key] = await loadAsset(key);
    if (disposed) return null;
    const before = props.length;
    plant(key, x, z, h, r);
    shadowsDirty = true;
    return props.length > before ? props[props.length - 1] : null;
  };
  const removeProp = (prop: PlacedProp) => {
    prop.node.removeFromParent();
    prop.contact?.removeFromParent();
    const index = props.indexOf(prop);
    if (index >= 0) props.splice(index, 1);
    shadowsDirty = true;
  };

  // Wind is driven by the caller's existing render loop: no second RAF.
  let lastTime = 0;
  const skyMaterial = sky.material;
  const blendColor = new THREE.Color();
  const startLight = new THREE.Color(palettes[period].light);
  const nightLight = new THREE.Color(palettes.Night.light);
  let lastVisualTime = -1;
  const update = (time: number, unixMs = Date.now()) => {
    // The synchronized world clock updates palettes without rebuilding the scene.
    if (Math.floor(unixMs / 1000) !== lastVisualTime) {
      lastVisualTime = Math.floor(unixMs / 1000);
      const blend = nightBlend(period, unixMs);
      const twilight = period === "Evening" ? blend : 0;
      skyMaterial.uniforms.topColor.value
        .setHex(palettes[period].sky)
        .lerp(new THREE.Color(palettes.Night.sky), twilight);
      skyMaterial.uniforms.horizonColor.value
        .setHex(palettes[period].horizon)
        .lerp(new THREE.Color(palettes.Night.horizon), twilight);
      if (scene.fog instanceof THREE.Fog)
        scene.fog.color.setHex(haze).lerp(new THREE.Color(0x315888), twilight);
      colors.light = blendColor
        .copy(startLight)
        .lerp(nightLight, twilight)
        .getHex();
      colors.intensity = THREE.MathUtils.lerp(
        palettes[period].intensity,
        palettes.Night.intensity,
        twilight,
      );
      colors.ambientIntensity =
        THREE.MathUtils.lerp(
          period === "Night" ? 0.72 : period === "Evening" ? 0.82 : 0.94,
          0.72,
          twilight,
        ) * LIGHT_LIFT;
      colors.fillIntensity =
        THREE.MathUtils.lerp(
          period === "Night" ? 0.38 : period === "Evening" ? 0.30 : 0.26,
          0.38,
          twilight,
        ) * LIGHT_LIFT;
      colors.moonIntensity =
        (period === "Night"
          ? 0.52
          : period === "Evening"
            ? THREE.MathUtils.smoothstep(blend, 0.42, 0.92) * 0.52
            : 0) * LIGHT_LIFT;
      colors.rimIntensity =
        period === "Night"
          ? 0.42
          : period === "Evening"
            ? THREE.MathUtils.lerp(
                0.18,
                0.42,
                THREE.MathUtils.smoothstep(blend, 0.42, 0.92),
              )
            : 0.08;
      starMaterial.opacity =
        THREE.MathUtils.smoothstep(blend, 0.2, 0.85) * 1.0;
      stars.visible = starMaterial.opacity > 0.01;
      if (period === "Evening") {
        const sunOpacity = 1 - THREE.MathUtils.smoothstep(blend, 0.3, 0.8);
        orb.material.opacity = sunOpacity;
        halo.material.opacity = sunOpacity;
        orb.position.y = THREE.MathUtils.lerp(11, 5.8, blend);
        halo.position.copy(orb.position);
        moon.material.opacity = THREE.MathUtils.smoothstep(blend, 0.55, 0.95);
        // Keep the shadow light fixed while twilight changes its color/intensity.
      }
      for (const cloud of clouds)
        cloud.sprite.traverse((node) => {
          if (node instanceof THREE.Sprite)
            node.material.color
              .setHex(cloudColor)
              .lerp(new THREE.Color(0x829dcd), twilight);
        });
      waterMaterial.uniforms.uDeep.value
        .setHex(0x118fb6)
        .lerp(new THREE.Color(0x0b4f94), blend);
      waterMaterial.uniforms.uSky.value
        .setHex(0x49b6db)
        .lerp(new THREE.Color(0x315f9f), blend);
      waterMaterial.uniforms.uGlint.value
        .setHex(period === "Night" || blend > 0.55 ? 0xd8ecff : 0xbfefff);
      waterMaterial.uniforms.uNight.value = blend;
      waterMaterial.uniforms.uLightDirection.value.copy(lightPosition).normalize();
    }
    const dt = lastTime ? Math.min(time - lastTime, 0.1) : 0;
    lastTime = time;
    wind.time.value = time;
    for (const cloud of clouds) {
      cloud.sprite.position.x =
        cloud.baseX +
        Math.sin(time * cloud.speed + cloud.phase) * (mobile ? 0.65 : 1.1);
    }
    if (!motes) return;
    for (let i = 0; i < moteCount; i++) {
      const s = moteSeed[i];
      let x = motePos[i * 3] + (0.3 + Math.sin(time * 0.45 + s) * 0.12) * dt;
      if (x > moteBox.x) x = -moteBox.x;
      motePos[i * 3] = x;
      motePos[i * 3 + 1] += Math.sin(time * 0.8 + s * 3) * 0.1 * dt;
      motePos[i * 3 + 2] += Math.cos(time * 0.55 + s * 2) * 0.08 * dt;
    }
    (motes.geometry.attributes.position as THREE.BufferAttribute).needsUpdate =
      true;
  };
  return {
    colors,
    consumeShadowUpdate() {
      const dirty = shadowsDirty;
      shadowsDirty = false;
      return dirty;
    },
    groundY: 0.04,
    // Handles used by the habitat editor.
    props,
    ready,
    spawn,
    removeProp,
    markShadowsDirty() {
      shadowsDirty = true;
    },
    floor,
    lake,
    bank,
    path,
    waterMaterial,
    bankMaterial: bank.material as THREE.MeshStandardMaterial,
    grass: carpet.mesh,
    flowers: [petals, centers] as THREE.InstancedMesh[],
    setCompanionShadowPosition(x: number, z: number, visible = true) {
      shadow.position.x = x;
      shadow.position.z = z;
      shadow.visible = visible;
    },
    lightPosition,
    update,
    dispose() {
      disposed = true;
      group.removeFromParent();
      own.forEach((resource) => resource.dispose());
    },
  };
}
