import * as THREE from "three";
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
  let seed = 12345;
  const rand = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Original distant meadow hills; the clearing has no grass spikes.
  const hillHeights = [
    2.630206529982388, 2.2325228529516608, 3.810013281647116, 2.065837584203109,
    4.013049598783255, 2.0916186154354364, 2.184061588253826, 2.823392118094489,
    3.4735751478001475, 2.38109595910646, 2.459535599220544, 4.201496494701132,
  ];
  for (let i = 0; i < hillHeights.length; i++) {
    const angle = (i * Math.PI) / 6;
    const hill = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: colors.ground, roughness: 1 }),
    );
    hill.position.set(Math.cos(angle) * 29, -1, Math.sin(angle) * 29);
    hill.scale.set(8, hillHeights[i], 8);
    group.add(hill);
  }
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
  const gradient = ctx.createRadialGradient(32, 32, 6, 32, 32, 32);
  // A dense contact center and broad soft edge anchor the companion’s feet.
  gradient.addColorStop(0, "rgba(3,10,7,.82)");
  gradient.addColorStop(0.35, "rgba(3,10,7,.62)");
  gradient.addColorStop(0.7, "rgba(3,10,7,.24)");
  gradient.addColorStop(1, "rgba(3,10,7,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.55, 1.8),
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
    dispose() {
      disposeGroup(group);
      scene.remove(group);
    },
  };
}
