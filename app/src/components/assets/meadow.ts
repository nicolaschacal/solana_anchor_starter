import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "meshoptimizer";
import { nightBlend } from "./twilight";
import type { WorldPeriod } from "../../hooks/useWorldClock";

const palettes = {
  Night: {
    sky: 0x111b3e,
    horizon: 0x455b82,
    ground: 0x244539,
    grass: 0x41614b,
    light: 0xa9c5ff,
    intensity: 1.1,
  },
  Morning: {
    sky: 0x80b9df,
    horizon: 0xffdfbd,
    ground: 0x607b40,
    grass: 0x92ab58,
    light: 0xffe4ba,
    intensity: 2.4,
  },
  Day: {
    sky: 0x559fda,
    horizon: 0xd2edf0,
    ground: 0x5c843c,
    grass: 0x95b953,
    light: 0xfff2d5,
    intensity: 2.6,
  },
  Evening: {
    sky: 0x656fa6,
    horizon: 0xf1bc9d,
    ground: 0x4c6240,
    grass: 0x818453,
    light: 0xffc191,
    intensity: 2.25,
  },
};
const moteColors = {
  Night: 0xbcd4ff,
  Morning: 0xfff0cf,
  Day: 0xffffff,
  Evening: 0xffd9b0,
};

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
  shore: "water-shore-straight.glb",
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
        if (key === "tree" || key === "pine" || key === "bush")
          addWind(gltf.scene, windStrength[key]);
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
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;
const wind = { time: { value: 0 }, gain: { value: reducedMotion ? 0.3 : 1 } };
const windStrength = { tree: 0.035, pine: 0.028, bush: 0.045 } as const;

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
function fitGround(o: THREE.Object3D, width: number) {
  return normalize(o, width, true);
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
    const x = rand() * 512,
      y = rand() * 512;
    const r = 22 + rand() * 74;
    ctx.beginPath();
    const points = 5 + Math.floor(rand() * 4);
    for (let p = 0; p < points; p++) {
      const a = (p / points) * Math.PI * 2;
      const rr = r * (0.65 + rand() * 0.45);
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (p === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle =
      rand() > 0.5 ? "rgba(139,177,72,.18)" : "rgba(50,99,47,.14)";
    ctx.fill();
  }

  // Sparse dirt islands mixed into the grass material.
  for (let i = 0; i < 12; i++) {
    const x = rand() * 512,
      y = rand() * 512;
    const rx = 18 + rand() * 42,
      ry = 10 + rand() * 28;
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
    const x = rand() * 512,
      y = rand() * 512;
    const len = 2 + rand() * 5;
    ctx.strokeStyle =
      rand() > 0.5 ? "rgba(177,208,90,.32)" : "rgba(37,82,39,.28)";
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

// A single rounded silhouette, rather than intersecting lit spheres. Colors
// are painted onto the vertices so clouds never acquire charcoal undersides.
function createCloudGroup(
  own: { dispose(): void }[],
  color: number,
  variant: number,
) {
  const shape = new THREE.Shape();
  shape.moveTo(-1.3, -0.18);
  shape.bezierCurveTo(-1.62, -0.13, -1.62, 0.28, -1.23, 0.32);
  shape.bezierCurveTo(-1.24, 0.65, -0.86, 0.81, -0.6, 0.57);
  shape.bezierCurveTo(-0.43, 1.02, 0.22, 1.05, 0.43, 0.63);
  shape.bezierCurveTo(0.76, 0.8, 1.08, 0.53, 1.06, 0.31);
  shape.bezierCurveTo(1.57, 0.34, 1.69, -0.17, 1.25, -0.22);
  shape.bezierCurveTo(0.66, -0.31, -0.68, -0.31, -1.3, -0.18);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.18,
    bevelEnabled: true,
    bevelThickness: 0.12,
    bevelSize: 0.12,
    bevelSegments: 3,
    steps: 1,
    curveSegments: 8,
  });
  const top = new THREE.Color(color);
  const bottom = top.clone().lerp(new THREE.Color(0x9da9cb), 0.28);
  const positions = geometry.attributes.position;
  const vertexColors: number[] = [];
  for (let i = 0; i < positions.count; i++) {
    // Broad asymmetric contours, including the underside; no cloned flat bases.
    const x = positions.getX(i),
      y = positions.getY(i);
    const phase = variant * 2.1;
    positions.setY(
      i,
      y * (1 + 0.18 * Math.sin(x * 1.6 + phase)) +
        0.065 * Math.sin(x * 3.2 + phase) +
        0.03 * Math.cos(x * 5.1 - phase),
    );
    positions.setX(i, x + 0.07 * Math.sin(y * 2.8 + phase));
    const blend = THREE.MathUtils.smoothstep(positions.getY(i), -0.35, 0.8);
    const tint = bottom.clone().lerp(top, blend);
    vertexColors.push(tint.r, tint.g, tint.b);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(vertexColors, 3),
  );
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    fog: false,
  });
  own.push(geometry, material);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, material));
  return group;
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

export function meadow(scene: THREE.Scene, period: WorldPeriod) {
  const colors = {
    ...palettes[period],
    ambientIntensity:
      period === "Night" ? 0.8 : period === "Evening" ? 1.5 : 1.9,
  };
  const group = new THREE.Group();
  scene.add(group);
  const mobile = matchMedia("(pointer: coarse)").matches || innerWidth <= 700;
  scene.background = new THREE.Color(colors.sky);
  // Cool distant haze preserves mountain separation even at sunset.
  const haze =
    period === "Night" ? 0x263c60 : period === "Evening" ? 0x8896b2 : 0xb2d4e2;
  scene.fog = new THREE.Fog(haze, 45, 120);
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
        uniforms: {
          topColor: { value: new THREE.Color(colors.sky) },
          horizonColor: { value: new THREE.Color(colors.horizon) },
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
        fragmentShader: `uniform vec3 topColor; uniform vec3 horizonColor;
        varying vec3 vSkyDirection;
        void main() {
          float height = normalize(vSkyDirection).y;
          float blend = smoothstep(-0.04, 0.48, height);
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
    track(new THREE.SphereGeometry(period === "Night" ? 0.8 : 1.04, 24, 16)),
    track(
      new THREE.MeshBasicMaterial({
        color: period === "Night" ? 0xe2eeff : 0xffe3af,
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
  group.add(orb);
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
  group.add(halo);

  const cloudColor =
    period === "Night"
      ? 0xb9c7e7
      : period === "Evening"
        ? 0xffe4d3
        : period === "Morning"
          ? 0xffead8
          : 0xffffff;
  const clouds: Array<{
    sprite: THREE.Group;
    speed: number;
  }> = [];
  const cloudDefs = [
    [-7.0, 14.6, -64, 2.35, 0.045],
    [8.0, 13.2, -66, 1.95, 0.032],
    [0.7, 17.0, -72, 2.2, 0.022],
  ];
  cloudDefs.forEach(([x, y, z, scale, speed], variant) => {
    const sprite = createCloudGroup(own, cloudColor, variant);
    sprite.position.set(0, y, z);
    sprite.scale.set(
      scale * (variant === 1 ? 1.12 : 1),
      scale * (variant === 2 ? 0.78 : 1),
      scale,
    );
    sprite.rotation.z = variant === 0 ? -0.035 : variant === 1 ? 0.025 : 0;
    // Repeated shared meshes keep the drift seamless even on wide displays.
    const layer = new THREE.Group();
    layer.position.x = x;
    layer.add(sprite);
    for (const offset of [-64, 64]) {
      const copy = sprite.clone(true);
      copy.position.x = offset;
      layer.add(copy);
    }
    group.add(layer);
    clouds.push({ sprite: layer, speed });
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
      color: 0xd4e6ff,
      size: 0.08,
      fog: false,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    }),
  );
  const stars = new THREE.Points(starGeometry, starMaterial);
  group.add(stars);
  const moon = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.8, 20, 12)),
    track(
      new THREE.MeshBasicMaterial({
        color: 0xdbe7ff,
        fog: false,
        transparent: true,
        opacity: 0,
      }),
    ),
  );
  moon.position.set(-4.4, 14, -64);
  if (period === "Evening") group.add(moon);
  const lightPosition = orb.position.clone();

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
          size: 0.075,
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
  // Analytic wave normals and bounded reflections: no screen-space reflection
  // pass, no extra render target, and no uncontrolled white specular highlight.
  const waterMaterial = track(
    new THREE.ShaderMaterial({
      fog: true,
      uniforms: {
        uTime: wind.time,
        uDeep: { value: new THREE.Color(0x245f79) },
        uSky: { value: new THREE.Color(colors.sky) },
        uGlint: { value: new THREE.Color(colors.light) },
        uNight: { value: 0 },
        ...THREE.UniformsLib.fog,
      },
      vertexShader: `varying vec3 vWaterWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWaterWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
      fragmentShader: `uniform float uTime; uniform float uNight;
      uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uGlint;
      varying vec3 vWaterWorld;
      #include <fog_pars_fragment>
      void main() {
        vec2 p = vWaterWorld.xz;
        float a = dot(p, vec2(1.4, 2.1)) + uTime * 1.25;
        float b = dot(p, vec2(-2.7, 1.6)) - uTime * 0.95;
        float c = dot(p, vec2(4.2, 3.3)) + uTime * 1.7;
        vec2 slope = vec2(1.4, 2.1) * cos(a) * 0.045
          + vec2(-2.7, 1.6) * cos(b) * 0.025
          + vec2(4.2, 3.3) * cos(c) * 0.009;
        vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
        vec3 view = normalize(cameraPosition - vWaterWorld);
        float fresnel = pow(1.0 - max(dot(normal, view), 0.0), 3.0);
        float wave = sin(a) * 0.5 + sin(b) * 0.3 + sin(c) * 0.2;
        vec3 base = uDeep * (0.96 + wave * 0.09);
        vec3 reflectedSky = uSky * (0.72 + normal.y * 0.15);
        vec3 color = mix(base, reflectedSky, 0.18 + fresnel * 0.4);
        vec3 halfDirection = normalize(view + normalize(vec3(0.15, 0.5, -1.0)));
        float glint = pow(max(dot(normal, halfDirection), 0.0), 80.0);
        color += uGlint * glint * mix(0.1, 0.04, uNight);
        gl_FragColor = vec4(color, 1.0);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    }),
  );
  const bank = new THREE.Mesh(
    lakeGeometry,
    track(new THREE.MeshStandardMaterial({ color: 0x8d9c69, roughness: 1 })),
  );
  bank.rotation.x = -Math.PI / 2;
  bank.position.set(1, 0.012, -13);
  bank.scale.set(1.05, 1.08, 1);
  group.add(bank);
  const lake = new THREE.Mesh(lakeGeometry, waterMaterial);
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(1, 0.025, -13);
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
  group.add(path);

  // Batched grass and flowers add near-field scale cues with five draw calls.
  const grassGeometry = track(new THREE.BufferGeometry());
  grassGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -0.025, 0, 0, 0.025, 0, 0, 0.035, 0.23, 0, -0.025, 0, 0, 0.035, 0.23, 0,
        0.005, 0.23, 0, 0.005, 0.23, 0, 0.035, 0.23, 0, 0.065, 0.34, 0, 0, 0,
        -0.02, 0, 0, 0.02, 0.02, 0.19, 0.01, 0, 0, -0.02, 0.02, 0.19, 0.01,
        0.02, 0.19, -0.015, 0.02, 0.19, -0.015, 0.02, 0.19, 0.01, 0.035, 0.26,
        -0.03,
      ],
      3,
    ),
  );
  grassGeometry.computeVertexNormals();
  const grassMaterial = track(
    new THREE.MeshStandardMaterial({
      color: 0x749e3c,
      side: THREE.DoubleSide,
      roughness: 1,
    }),
  );
  const tuftCount = mobile ? 180 : 320;
  const tufts = new THREE.InstancedMesh(
    grassGeometry,
    grassMaterial,
    tuftCount,
  );
  const matrix = new THREE.Object3D();
  const flowerLocations: THREE.Vector3[] = [];
  for (let i = 0; i < tuftCount; i++) {
    const z = -7 + rand() * 10;
    const x = (rand() < 0.5 ? -1 : 1) * (1.65 + rand() * 6.5);
    matrix.position.set(x, 0.03, z);
    matrix.rotation.set(0, rand() * Math.PI, 0);
    matrix.scale.setScalar(0.6 + rand() * 0.8);
    matrix.updateMatrix();
    tufts.setMatrixAt(i, matrix.matrix);
    tufts.setColorAt(
      i,
      new THREE.Color().setHSL(
        0.22 + rand() * 0.06,
        0.42,
        0.28 + rand() * 0.16,
      ),
    );
    if (i % 4 === 0 && Math.abs(x) < 5)
      flowerLocations.push(new THREE.Vector3(x, 0.16 + rand() * 0.14, z));
  }
  addWind(tufts, 0.09);
  tufts.instanceMatrix.needsUpdate = true;
  track(tufts);
  group.add(tufts);
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
  void (async () => {
    const keys = Object.keys(files) as AssetKey[];
    const loaded = await Promise.all(keys.map(loadAsset));
    if (disposed) return;
    const a = Object.fromEntries(
      keys.map((key, i) => [key, loaded[i]]),
    ) as Record<AssetKey, THREE.Group | null>;
    const plant = (key: AssetKey, x: number, z: number, h: number, r = 0) => {
      const prop = put(a[key], group, x, z, h, r);
      if (prop && key !== "mountains" && key !== "shore") {
        const contact = new THREE.Mesh(shadow.geometry, shadow.material);
        contact.position.set(x, 0.022, z);
        contact.rotation.x = -Math.PI / 2;
        contact.scale.set(h * 0.36, h * 0.3, 1);
        group.add(contact);
      }
      return prop;
    };
    // Three overlapping ridgelines, readable through a gentle aerial haze.
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
                ? 0x43577b
                : 0x304868
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
    // Far woodland gives the lake a shoreline and connects it to the mountains.
    const forest = mobile ? 10 : 18;
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
    // Middle ground: trunks inside the portrait frustum, crowns frame the sky.
    plant("tree", -3.0, -5.8, 6.6, 0.28);
    plant("pine", 3.3, -7.6, 6.0, -0.35);
    plant("tree", -6.8, -11, 5.0, 0.7);
    plant("pine", 7.8, -13.5, 4.9, 0.5);
    plant("pine", -3.8, -15.8, 3.6, 0.2);
    plant("tree", 5.8, -18, 3.4, 2.4);
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
    if (a.shore) {
      const shore = fitGround(a.shore.clone(true), 4.6);
      shore.updateMatrixWorld(true);
      // Sink the thick tile into the continuous terrain: only the bank is visible.
      const bounds = new THREE.Box3().setFromObject(shore);
      shore.position.y -= bounds.max.y - 0.12;
      shore.position.x += -4.5;
      shore.position.z += -11.4;
      group.add(shore);
    }
  })();

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
        scene.fog.color.setHex(haze).lerp(new THREE.Color(0x263c60), twilight);
      colors.light = blendColor
        .copy(startLight)
        .lerp(nightLight, twilight)
        .getHex();
      colors.intensity = THREE.MathUtils.lerp(
        palettes[period].intensity,
        palettes.Night.intensity,
        twilight,
      );
      colors.ambientIntensity = THREE.MathUtils.lerp(
        period === "Night" ? 0.8 : period === "Evening" ? 1.5 : 1.9,
        0.8,
        twilight,
      );
      starMaterial.opacity =
        THREE.MathUtils.smoothstep(blend, 0.25, 0.9) * 0.85;
      stars.visible = starMaterial.opacity > 0.01;
      if (period === "Evening") {
        const sunOpacity = 1 - THREE.MathUtils.smoothstep(blend, 0.3, 0.8);
        orb.material.opacity = sunOpacity;
        halo.material.opacity = sunOpacity;
        orb.position.y = THREE.MathUtils.lerp(11, 5.8, blend);
        halo.position.copy(orb.position);
        moon.material.opacity = THREE.MathUtils.smoothstep(blend, 0.55, 0.95);
        lightPosition.copy(
          moon.material.opacity > 0.5 ? moon.position : orb.position,
        );
      }
      for (const cloud of clouds)
        cloud.sprite.traverse((node) => {
          if (node instanceof THREE.Mesh)
            (node.material as THREE.MeshBasicMaterial).color
              .setRGB(1, 1, 1)
              .lerp(new THREE.Color(0x64749a), blend * 0.7);
        });
      waterMaterial.uniforms.uDeep.value
        .setHex(0x245f79)
        .lerp(new THREE.Color(0x122c4d), blend);
      waterMaterial.uniforms.uSky.value.copy(
        skyMaterial.uniforms.horizonColor.value,
      );
      waterMaterial.uniforms.uGlint.value.setHex(colors.light);
      waterMaterial.uniforms.uNight.value = blend;
    }
    const dt = lastTime ? Math.min(time - lastTime, 0.1) : 0;
    lastTime = time;
    wind.time.value = time;
    for (const cloud of clouds) {
      // A steady breeze carries clouds in one direction rather than rocking them.
      // Capped frame time prevents jumps after returning from a hidden tab.
      if (!reducedMotion) {
        cloud.sprite.position.x += cloud.speed * dt;
        if (cloud.sprite.position.x >= 32) cloud.sprite.position.x -= 64;
      }
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
    groundY: 0.04,
    lightPosition,
    update,
    dispose() {
      disposed = true;
      group.removeFromParent();
      own.forEach((resource) => resource.dispose());
    },
  };
}
