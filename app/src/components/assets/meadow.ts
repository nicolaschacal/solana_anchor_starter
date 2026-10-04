import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "meshoptimizer";
import type { WorldPeriod } from "../../hooks/useWorldClock";
const palettes = {
  Night: {
    sky: 0x101e42,
    ground: 0x244539,
    grass: 0x41614b,
    light: 0xa9c5ff,
    intensity: 1.4,
  },
  Morning: {
    sky: 0x9bbfcb,
    ground: 0x607b40,
    grass: 0x92ab58,
    light: 0xffe4ba,
    intensity: 2.4,
  },
  Day: {
    sky: 0x83c4e3,
    ground: 0x5c843c,
    grass: 0x95b953,
    light: 0xfff2d5,
    intensity: 2.6,
  },
  Evening: {
    sky: 0x696886,
    ground: 0x4c6240,
    grass: 0x818453,
    light: 0xffc191,
    intensity: 2,
  },
};
// Cache the small compressed download, not disposable GPU objects. Each mounted
// scene parses its own resources so changing periods cannot dispose another view.
const environmentUri = "/assets/environments/stylized-valley/valley.glb";
let environmentBytes: Promise<ArrayBuffer> | undefined;
function loadEnvironmentBytes() {
  if (!environmentBytes) {
    environmentBytes = fetch(environmentUri)
      .then((response) => {
        if (!response.ok)
          throw Error(`Environment download failed: ${response.status}`);
        return response.arrayBuffer();
      })
      .catch((error) => {
        environmentBytes = undefined;
        throw error;
      });
  }
  return environmentBytes;
}
function disposeGroup(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  group.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material)
      for (const material of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material])
        materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
    material.dispose();
  });
  textures.forEach((texture) => texture.dispose());
}
export function meadow(scene: THREE.Scene, period: WorldPeriod) {
  const colors = palettes[period];
  const group = new THREE.Group();
  scene.add(group);
  scene.background = new THREE.Color(colors.sky);
  scene.fog = new THREE.Fog(colors.sky, 24, 65);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: colors.ground, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  group.add(floor);
  let disposed = false;
  const ready = loadEnvironmentBytes()
    .then((bytes) =>
      new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, ""),
    )
    .then((model) => {
      if (disposed) {
        disposeGroup(model.scene);
        return false;
      }
      model.scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = false;
          mesh.receiveShadow = false;
        }
      });
      group.add(model.scene);
      floor.visible = false;
      return true;
    })
    // Keep the small clearing visible if an offline/corrupt download fails.
    .catch(() => false);
  let seed = 12345;
  const rand = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(period === "Night" ? 0.65 : 1, 20, 12),
    new THREE.MeshBasicMaterial({
      color: period === "Night" ? 0xe2eeff : 0xffe3af,
      fog: false,
    }),
  );
  orb.position.set(-3, 6, -28);
  group.add(orb);
  if (period === "Night") {
    const positions = [];
    for (let i = 0; i < 100; i++) {
      const a = rand() * Math.PI * 2,
        r = 35;
      positions.push(Math.cos(a) * r, 4 + rand() * 14, Math.sin(a) * r);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    group.add(
      new THREE.Points(
        geo,
        new THREE.PointsMaterial({ color: 0xd4e6ff, size: 0.085, fog: false }),
      ),
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 3, 32, 32, 32);
  gradient.addColorStop(0, "rgba(5,18,18,.48)");
  gradient.addColorStop(1, "rgba(5,18,18,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 1.8),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.001;
  group.add(shadow);
  return {
    colors,
    ready,
    dispose() {
      disposed = true;
      disposeGroup(group);
      scene.remove(group);
    },
  };
}
