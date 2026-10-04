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
export function meadow(scene: THREE.Scene, period: WorldPeriod) {
  const colors = palettes[period];
  const group = new THREE.Group();
  scene.add(group);
  scene.background = new THREE.Color(colors.sky);
  scene.fog = new THREE.Fog(colors.sky, 12, 48);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: colors.ground, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  group.add(floor);
  const grass = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.055, 0.22, 3),
    new THREE.MeshStandardMaterial({ color: colors.grass, roughness: 1 }),
    360,
  );
  const matrix = new THREE.Matrix4();
  let seed = 12345;
  const rand = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 360; i++) {
    const a = rand() * Math.PI * 2,
      r = 1.7 + rand() * 15;
    matrix.compose(
      new THREE.Vector3(Math.cos(a) * r, 0.07, Math.sin(a) * r),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a),
      new THREE.Vector3(1, 0.6 + rand(), 1),
    );
    grass.setMatrixAt(i, matrix);
  }
  group.add(grass);
  // Broad hills close the horizon in every camera direction.
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const hill = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: colors.ground, roughness: 1 }),
    );
    hill.position.set(Math.cos(a) * 29, -1, Math.sin(a) * 29);
    hill.scale.set(8, 2 + rand() * 3, 8);
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
    dispose() {
      texture.dispose();
      group.traverse((n) => {
        const m = n as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material)
          for (const mat of Array.isArray(m.material)
            ? m.material
            : [m.material])
            mat.dispose();
      });
      scene.remove(group);
    },
  };
}
