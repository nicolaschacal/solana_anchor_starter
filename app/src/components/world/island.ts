import * as THREE from "three";
import { meadowTexture } from "../assets/habitat-materials";

/**
 * The habitat as a floating island: a rounded, slightly irregular lawn on top and a craggy
 * low-poly underside that tapers to a point, with a few small rocks drifting around it. It
 * replaces the editor's square earth block; the 5x5 board still sits inside the lawn.
 */

const SIDES = 40;
const RADIUS = 3.1; // the board's edge midpoints are 2.5 from the centre; its corners 3.5
const SQUARENESS = 3.2; // 2 is a circle, large is a square

/** Lawn outline: a rounded square with gentle lumps. */
const outline = (angle: number) => {
  const c = Math.abs(Math.cos(angle)),
    s = Math.abs(Math.sin(angle));
  const base = RADIUS / Math.pow(Math.pow(c, SQUARENESS) + Math.pow(s, SQUARENESS), 1 / SQUARENESS);
  return base + 0.11 * Math.sin(angle * 3 + 1.3) + 0.08 * Math.sin(angle * 5 + 0.4) + 0.05 * Math.sin(angle * 9 + 2.1);
};

// Where each ring of the underside sits: shrink factor, depth, colour.
const RINGS: { k: number; y: number; colour: number }[] = [
  { k: 1.0, y: 0, colour: 0x5f8f42 },
  { k: 0.98, y: -0.16, colour: 0x6f6a3c },
  { k: 0.88, y: -0.7, colour: 0x7a5a3b },
  { k: 0.7, y: -1.4, colour: 0x68503a },
  { k: 0.46, y: -2.1, colour: 0x5b4b40 },
  { k: 0.2, y: -2.75, colour: 0x4f4549 },
];
const TIP = { y: -3.15, colour: 0x453f45 };

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

export type Island = { update(seconds: number): void; dispose(): void };

export function createIsland(scene: THREE.Scene, centre: { x: number; z: number }, scale = 1): Island {
  const rand = seeded(2718);
  const group = new THREE.Group();
  group.name = "island";
  group.position.set(centre.x, 0, centre.z);
  group.scale.setScalar(scale);

  // Ring vertices, with the underside's rings jittered so it reads as rock.
  const ring = (r: (typeof RINGS)[number], index: number) =>
    Array.from({ length: SIDES }, (_, n) => {
      const a = (n / SIDES) * Math.PI * 2;
      const jitter = index === 0 ? 1 : 1 + (rand() - 0.5) * (0.12 + index * 0.05);
      const radius = outline(a) * r.k * jitter;
      const dy = index === 0 ? 0 : (rand() - 0.5) * 0.3;
      return new THREE.Vector3(Math.cos(a) * radius, r.y + dy, Math.sin(a) * radius);
    });
  const rings = RINGS.map(ring);
  const tip = new THREE.Vector3(0, TIP.y, 0);

  const positions: number[] = [];
  const colours: number[] = [];
  const colour = new THREE.Color();
  const push = (v: THREE.Vector3, hex: number) => {
    positions.push(v.x, v.y, v.z);
    colour.setHex(hex);
    colours.push(colour.r, colour.g, colour.b);
  };
  for (let n = 0; n < SIDES; n++) {
    const m = (n + 1) % SIDES;
    for (let r = 0; r < RINGS.length - 1; r++) {
      const a = rings[r][n],
        b = rings[r][m],
        c = rings[r + 1][m],
        d = rings[r + 1][n];
      const top = RINGS[r].colour,
        bottom = RINGS[r + 1].colour;
      push(a, top);
      push(d, bottom);
      push(b, top);
      push(b, top);
      push(d, bottom);
      push(c, bottom);
    }
    const last = RINGS.length - 1;
    push(rings[last][n], RINGS[last].colour);
    push(tip, TIP.colour);
    push(rings[last][m], RINGS[last].colour);
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  body.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  body.computeVertexNormals();
  const bodyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, side: THREE.DoubleSide });
  const underside = new THREE.Mesh(body, bodyMaterial);
  underside.receiveShadow = true;

  // The lawn: a fan from the middle, painted with the game's meadow.
  const lawn: number[] = [];
  const uvs: number[] = [];
  const uv = (x: number, z: number) => uvs.push((x + centre.x + 60) / 120, (60 - (z + centre.z)) / 120);
  for (let n = 0; n < SIDES; n++) {
    const a = rings[0][n],
      b = rings[0][(n + 1) % SIDES];
    lawn.push(0, 0, 0, b.x, 0, b.z, a.x, 0, a.z);
    uv(0, 0);
    uv(b.x, b.z);
    uv(a.x, a.z);
  }
  const lawnGeometry = new THREE.BufferGeometry();
  lawnGeometry.setAttribute("position", new THREE.Float32BufferAttribute(lawn, 3));
  lawnGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  lawnGeometry.setAttribute("normal", new THREE.Float32BufferAttribute(Array.from({ length: lawn.length / 3 }, () => [0, 1, 0]).flat(), 3));
  const lawnMaterial = new THREE.MeshStandardMaterial({ map: meadowTexture(), roughness: 0.96 });
  const top = new THREE.Mesh(lawnGeometry, lawnMaterial);
  top.receiveShadow = true;
  group.add(underside, top);

  // A few rocks drifting below and around.
  const rockGeometry = new THREE.IcosahedronGeometry(1, 0);
  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x6a5642, flatShading: true, roughness: 1 });
  const rocks = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
    const mesh = new THREE.Mesh(rockGeometry, rockMaterial);
    const angle = 0.7 + n * 1.65 + rand() * 0.4;
    const radius = 3.9 + rand() * 3.2;
    const size = 0.14 + rand() * (n % 3 === 0 ? 0.3 : 0.2);
    mesh.scale.set(size * 1.2, size, size);
    mesh.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    group.add(mesh);
    return { mesh, x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, y: -0.6 - rand() * 3.8, phase: rand() * 6 };
  });
  // Small islets far off, the same shape in miniature.
  const islets = [
    { angle: 0.5, radius: 13, y: -3.5, size: 0.34 },
    { angle: 2.5, radius: 17, y: -6.5, size: 0.26 },
    { angle: 4.3, radius: 15, y: -2.2, size: 0.22 },
    { angle: 5.6, radius: 21, y: -8, size: 0.4 },
  ].map((spec, n) => {
    const islet = new THREE.Group();
    const lowerBody = new THREE.Mesh(body, bodyMaterial);
    const lowerTop = new THREE.Mesh(lawnGeometry, lawnMaterial);
    islet.add(lowerBody, lowerTop);
    islet.scale.setScalar(spec.size);
    islet.rotation.y = n * 1.9;
    group.add(islet);
    return { islet, ...spec };
  });
  scene.add(group);

  return {
    update(seconds) {
      for (const rock of rocks) {
        rock.mesh.position.set(rock.x, rock.y + Math.sin(seconds * 0.6 + rock.phase) * 0.12, rock.z);
        rock.mesh.rotation.y += 0.002;
      }
      for (const [n, spec] of islets.entries()) {
        spec.islet.position.set(Math.cos(spec.angle) * spec.radius, spec.y + Math.sin(seconds * 0.35 + n * 2) * 0.3, Math.sin(spec.angle) * spec.radius);
      }
    },
    dispose() {
      group.removeFromParent();
      body.dispose();
      bodyMaterial.dispose();
      lawnGeometry.dispose();
      lawnMaterial.dispose();
      rockGeometry.dispose();
      rockMaterial.dispose();
    },
  };
}
