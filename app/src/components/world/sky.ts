import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { WorldPeriod } from "../../hooks/useWorldClock";
import { moonTexture } from "../assets/habitat-materials";
import { nightBlend } from "../assets/twilight";

/**
 * The world's own sky furniture: a sun by day, a moon and stars by night, and low-poly clouds
 * that drift slowly around the habitat. The sky gradient and the lights come from the game's
 * meadow; this adds what is in the sky. Everything is cheap (a handful of flat-shaded meshes).
 */

const SUN_AZIMUTH = Math.atan2(7, -8); // where the game's key light comes from
const MOON_AZIMUTH = Math.atan2(-4.5, -5);
const RANGE = 88;

const TINT: Record<WorldPeriod, { cloud: number; glow: number; disc: number }> = {
  Morning: { cloud: 0xffe9d9, glow: 0xffc98a, disc: 0xffdca8 },
  Day: { cloud: 0xffffff, glow: 0xffe2a0, disc: 0xfff1c4 },
  Evening: { cloud: 0xffcfb4, glow: 0xff8c55, disc: 0xffa860 },
  Night: { cloud: 0x8ba3d2, glow: 0xb9d3ff, disc: 0xe2eeff },
};
const NIGHT_CLOUD = new THREE.Color(0x8ba3d2);

const direction = (azimuth: number, elevation: number, out: THREE.Vector3) =>
  out.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

/** One cumulus: a row of faceted lumps with a flat underside, like the rest of the game's low-poly props. */
function cloudGeometry(variant: number) {
  const rand = seeded(4177 + variant * 911);
  const lumps = 4 + (variant % 3);
  const parts: THREE.BufferGeometry[] = [];
  for (let n = 0; n < lumps; n++) {
    const t = lumps === 1 ? 0.5 : n / (lumps - 1);
    const hump = Math.sin(t * Math.PI);
    const r = 0.5 + hump * 0.42 + rand() * 0.16;
    const lump = new THREE.IcosahedronGeometry(r, 1);
    lump.scale(1.18, 0.82, 1);
    lump.rotateY(rand() * Math.PI);
    lump.translate((t - 0.5) * 2.7 + (rand() - 0.5) * 0.2, r * 0.38, (rand() - 0.5) * 0.45);
    parts.push(lump);
  }
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
  parts.forEach((g) => g.dispose());
  // A flat underside.
  const at = merged.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < at.count; i++) at.setY(i, Math.max(at.getY(i), 0.02));
  merged.computeVertexNormals();
  return merged;
}

function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,0.55)");
  g.addColorStop(0.3, "rgba(255,255,255,0.2)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export type WorldSky = {
  setPeriod(period: WorldPeriod): void;
  update(dt: number, camera: THREE.Camera, clockMs: number): void;
  dispose(): void;
};

export function createSky(scene: THREE.Scene, centre: { x: number; z: number }, initial: WorldPeriod): WorldSky {
  let period = initial;
  const own: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(r: T) => (own.push(r), r);
  const rand = seeded(99);

  // ---- Things at infinity: they travel with the camera ----------------------------
  const dome = new THREE.Group();
  dome.name = "world-sky";
  const sunMaterial = track(new THREE.MeshBasicMaterial({ color: TINT.Day.disc, toneMapped: false, fog: false, transparent: true }));
  const sun = new THREE.Mesh(track(new THREE.IcosahedronGeometry(3.4, 1)), sunMaterial);
  const moonMaterial = track(
    new THREE.MeshBasicMaterial({ color: 0xe6efff, map: moonTexture(), toneMapped: false, fog: false, transparent: true }),
  );
  const moon = new THREE.Mesh(track(new THREE.IcosahedronGeometry(2.7, 1)), moonMaterial);
  const glowMap = track(glowTexture());
  const sunGlow = new THREE.Sprite(
    track(new THREE.SpriteMaterial({ map: glowMap, color: TINT.Day.glow, transparent: true, depthWrite: false, fog: false, toneMapped: false })),
  );
  const moonGlow = new THREE.Sprite(
    track(new THREE.SpriteMaterial({ map: glowMap, color: TINT.Night.glow, transparent: true, depthWrite: false, fog: false, toneMapped: false })),
  );
  sunGlow.scale.setScalar(24);
  moonGlow.scale.setScalar(17);

  const starPositions: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < 150; i++) {
    const az = rand() * Math.PI * 2;
    const el = Math.asin(-0.85 + rand() * 1.2);
    direction(az, el, v).multiplyScalar(RANGE + 4);
    starPositions.push(v.x, v.y, v.z);
  }
  const starGeometry = track(new THREE.BufferGeometry());
  starGeometry.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
  const starMaterial = track(
    new THREE.PointsMaterial({
      color: 0xeaf2ff,
      size: 0.5,
      toneMapped: false,
      fog: false,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
    }),
  );
  const stars = new THREE.Points(starGeometry, starMaterial);
  stars.frustumCulled = false;
  dome.add(stars, sunGlow, moonGlow, sun, moon);
  for (const o of [sun, moon, sunGlow, moonGlow]) o.frustumCulled = false;
  scene.add(dome);

  // ---- Clouds: faceted, flat underside, drifting around the habitat -------------
  const cloudMaterial = track(
    new THREE.MeshStandardMaterial({ color: TINT.Day.cloud, emissive: TINT.Day.cloud, emissiveIntensity: 0.5, roughness: 1, flatShading: true, fog: false }),
  );
  const geometries = [0, 1, 2].map((n) => track(cloudGeometry(n)));
  const clouds = new THREE.Group();
  clouds.name = "world-clouds";
  clouds.position.set(centre.x, 0, centre.z);
  const drifting: { mesh: THREE.Mesh; radius: number; angle: number; speed: number }[] = [];
  const COUNT = 14;
  for (let n = 0; n < COUNT; n++) {
    const mesh = new THREE.Mesh(geometries[n % 3], cloudMaterial);
    const radius = 12 + rand() * 14;
    const angle = (n / COUNT) * Math.PI * 2 + rand() * 0.4;
    mesh.position.set(0, -6.4 + rand() * 4.4, 0);
    const scale = 1.2 + rand() * 0.9;
    mesh.scale.set(scale * (1 + rand() * 0.3), scale * (0.85 + rand() * 0.3), scale);
    mesh.rotation.y = rand() * Math.PI * 2;
    drifting.push({ mesh, radius, angle, speed: (0.006 + rand() * 0.008) * (n % 2 ? 1 : -1) });
    clouds.add(mesh);
  }
  scene.add(clouds);

  const sunDir = new THREE.Vector3();
  const smooth = THREE.MathUtils.smoothstep;
  let last = -1;
  let blend = 0;
  let lift = 0.3;

  const colours = () => {
    const t = TINT[period];
    sunMaterial.color.setHex(t.disc);
    sunGlow.material.color.setHex(t.glow);
    cloudMaterial.color.setHex(t.cloud).lerp(NIGHT_CLOUD, period === "Evening" ? blend : 0);
    cloudMaterial.emissive.copy(cloudMaterial.color);
    cloudMaterial.emissiveIntensity = period === "Night" ? 0.55 : 0.5 + (period === "Evening" ? blend * 0.05 : 0);
  };
  colours();

  return {
    setPeriod(next) {
      period = next;
      last = -1;
    },
    update(dt, camera, clockMs) {
      dome.position.copy(camera.position);
      // The island is seen from above, so the sky behind it lies below the horizon: the sun and
      // moon keep their compass bearing and ride at a fixed height in the view.
      const look = Math.asin(THREE.MathUtils.clamp(camera.getWorldDirection(sunDir).y, -1, 1));
      const high = Math.min(look + lift, 0.45);
      direction(SUN_AZIMUTH, high, sunDir).multiplyScalar(RANGE);
      sun.position.copy(sunDir);
      sunGlow.position.copy(sunDir);
      moon.position.copy(direction(MOON_AZIMUTH, Math.min(look + 0.28, 0.45), v).multiplyScalar(RANGE));
      moonGlow.position.copy(moon.position);
      const second = Math.floor(clockMs / 1000);
      if (second !== last) {
        last = second;
        blend = nightBlend(period, clockMs);
        colours();
        const dusk = period === "Evening";
        const sunUp = period === "Night" ? 0 : dusk ? 1 - smooth(blend, 0.3, 0.8) : 1;
        const moonUp = period === "Night" ? 1 : dusk ? smooth(blend, 0.55, 0.95) : 0;
        lift = period === "Morning" ? 0.2 : dusk ? THREE.MathUtils.lerp(0.22, 0.04, blend) : 0.3;
        sun.visible = sunGlow.visible = sunUp > 0.01;
        moon.visible = moonGlow.visible = moonUp > 0.01;
        sunMaterial.opacity = sunUp;
        sunGlow.material.opacity = sunUp;
        moonMaterial.opacity = moonUp;
        moonGlow.material.opacity = moonUp;
        starMaterial.opacity = smooth(period === "Night" ? 1 : dusk ? blend : 0, 0.2, 0.85);
        stars.visible = starMaterial.opacity > 0.01;
      }
      for (const c of drifting) {
        c.angle += c.speed * dt;
        c.mesh.position.x = Math.sin(c.angle) * c.radius;
        c.mesh.position.z = Math.cos(c.angle) * c.radius;
      }
    },
    dispose() {
      dome.removeFromParent();
      clouds.removeFromParent();
      own.forEach((r) => r.dispose());
    },
  };
}
