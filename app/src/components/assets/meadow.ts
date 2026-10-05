import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { WorldPeriod } from "../../hooks/useWorldClock";

const palettes = {
  Night: { sky: 0x101e42, ground: 0x244539, grass: 0x41614b, light: 0xa9c5ff, intensity: 1.4 },
  Morning: { sky: 0x9bbfcb, ground: 0x607b40, grass: 0x92ab58, light: 0xffe4ba, intensity: 2.4 },
  Day: { sky: 0x83c4e3, ground: 0x5c843c, grass: 0x95b953, light: 0xfff2d5, intensity: 2.6 },
  Evening: { sky: 0x696886, ground: 0x4c6240, grass: 0x818453, light: 0xffc191, intensity: 2 },
};

const ENV = "/assets/environment/";
const assetFiles = {
  grass: "grass-tile.glb",
  pine: "pine-tree.glb",
  tree: "deciduous-tree.glb",
  bush: "berry-bush.glb",
  rocks: "mossy-rocks.glb",
  stump: "tree-stump.glb",
  log: "hollow-log.glb",
  mushrooms: "red-mushrooms.glb",
} as const;

function disposeGroup(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  group.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  });
  textures.forEach((texture) => texture.dispose());
}

function normalized(object: THREE.Object3D, height: number) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const scale = height / Math.max(size.y, 0.001);
  object.scale.setScalar(scale);
  object.updateMatrixWorld(true);
  const scaled = new THREE.Box3().setFromObject(object);
  const center = scaled.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= scaled.min.y;
  return object;
}

function normalizedGround(object: THREE.Object3D, width: number) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const scale = width / Math.max(size.x, size.z, 0.001);
  object.scale.setScalar(scale);
  object.updateMatrixWorld(true);
  const scaled = new THREE.Box3().setFromObject(object);
  const center = scaled.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= scaled.min.y;
  return object;
}

function place(source: THREE.Object3D, parent: THREE.Group, x: number, z: number, height: number, rotation = 0) {
  const item = normalized(source.clone(true), height);
  item.position.x += x;
  item.position.z += z;
  item.rotation.y = rotation;
  parent.add(item);
  return item;
}

export function meadow(scene: THREE.Scene, period: WorldPeriod) {
  const colors = palettes[period];
  const group = new THREE.Group();
  scene.add(group);
  scene.background = new THREE.Color(colors.sky);
  scene.fog = new THREE.Fog(colors.sky, 20, 54);

  // The broad floor is only a fallback below the supplied grass tiles.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 160),
    new THREE.MeshStandardMaterial({ color: colors.ground, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.035;
  group.add(floor);

  let seed = 12345;
  const rand = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // Keep the existing time-of-day sky behavior.
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(period === "Night" ? 0.65 : 1, 20, 12),
    new THREE.MeshBasicMaterial({ color: period === "Night" ? 0xe2eeff : 0xffe3af, fog: false }),
  );
  orb.position.set(-3, 6, -28);
  group.add(orb);
  if (period === "Night") {
    const positions: number[] = [];
    for (let i = 0; i < 100; i++) {
      const a = rand() * Math.PI * 2;
      positions.push(Math.cos(a) * 35, 4 + rand() * 14, Math.sin(a) * 35);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    group.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xd4e6ff, size: 0.085, fog: false })));
  }

  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = shadowCanvas.height = 64;
  const ctx = shadowCanvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 6, 32, 32, 32);
  gradient.addColorStop(0, "rgba(3,10,7,.82)");
  gradient.addColorStop(0.35, "rgba(3,10,7,.62)");
  gradient.addColorStop(0.7, "rgba(3,10,7,.24)");
  gradient.addColorStop(1, "rgba(3,10,7,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.8, 1.9),
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, 0.012, 0.1);
  group.add(shadow);

  const loader = new GLTFLoader();
  const living: { object: THREE.Object3D; phase: number; amount: number }[] = [];
  let disposed = false;

  const load = async (key: keyof typeof assetFiles) => {
    try {
      const gltf = await loader.loadAsync(ENV + assetFiles[key]);
      return gltf.scene;
    } catch (error) {
      console.warn("[Rebyters] Environment asset failed:", assetFiles[key], error);
      return null;
    }
  };

  void Promise.all([
    load("grass"), load("pine"), load("tree"), load("bush"),
    load("rocks"), load("stump"), load("log"), load("mushrooms"),
  ]).then(([grass, pine, tree, bush, rocks, stump, log, mushrooms]) => {
    if (disposed) return;

    // A continuous clearing made only from the supplied grass tile.
    if (grass) {
      for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
        const tile = normalizedGround(grass.clone(true), 4.35);
        tile.position.set(x * 4.2, -0.025, z * 4.2);
        tile.rotation.y = ((x + z) & 1) ? Math.PI / 2 : 0;
        group.add(tile);
      }
    }

    // Frame the companion instead of covering it: taller assets stay on the edges/back.
    const tall = [
      [tree, -5.4, -5.8, 6.8, 0.18], [pine, 5.5, -6.4, 7.5, -0.22],
      [pine, -7.2, -2.1, 6.1, 0.36], [tree, 7.1, -2.8, 6.4, -0.3],
      [tree, -6.7, 3.5, 5.8, 0.1], [pine, 6.8, 3.7, 6.6, -0.12],
    ] as const;
    tall.forEach(([asset, x, z, h, r], i) => {
      if (!asset) return;
      const item = place(asset, group, x, z, h, r);
      living.push({ object: item, phase: i * 0.9, amount: 0.012 + (i % 3) * 0.003 });
    });

    if (bush) {
      [[-3.8,-2.8],[3.9,-3.2],[-4.5,2.2],[4.7,2.5],[-2.8,4.2],[3.0,4.5]].forEach(([x,z], i) => {
        const item = place(bush, group, x, z, 1.15 + (i % 2) * 0.2, i * 0.7);
        living.push({ object: item, phase: i * 0.63, amount: 0.022 });
      });
    }
    if (rocks) { place(rocks, group, -2.9, 1.9, 0.75, 0.3); place(rocks, group, 3.2, 1.5, 0.62, -0.4); }
    if (stump) place(stump, group, -4.0, 0.1, 0.95, 0.2);
    if (log) place(log, group, 4.1, 0.3, 0.82, -0.5);
    if (mushrooms) { place(mushrooms, group, -2.1, -1.6, 0.48, 0.15); place(mushrooms, group, 2.4, -1.9, 0.4, -0.25); }
  });

  // Subtle wind: enough motion to make the world feel alive without looking elastic.
  let raf = 0;
  const started = performance.now();
  const wind = (now: number) => {
    if (disposed) return;
    const t = (now - started) / 1000;
    for (const item of living) {
      item.object.rotation.z = Math.sin(t * 0.72 + item.phase) * item.amount;
      item.object.rotation.x = Math.sin(t * 0.48 + item.phase * 1.7) * item.amount * 0.35;
    }
    raf = requestAnimationFrame(wind);
  };
  raf = requestAnimationFrame(wind);

  return {
    colors,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      disposeGroup(group);
      scene.remove(group);
    },
  };
}
