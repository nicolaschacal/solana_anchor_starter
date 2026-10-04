// Usage: node scripts/assets/build-stylized-valley.mjs /path/to/source-glbs
// Source filenames and CC0 download URLs are recorded in the output manifest.
import fs from "node:fs/promises";
import process from "node:process";
import console from "node:console";
import path from "node:path";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  copyToDocument,
  dedup,
  prune,
  flatten,
  join,
  weld,
  meshopt,
  unpartition,
  simplify,
} from "@gltf-transform/functions";
import {
  MeshoptEncoder,
  MeshoptDecoder,
  MeshoptSimplifier,
} from "meshoptimizer";
import sharp from "sharp";
import * as THREE from "three";
const source = process.argv[2];
if (!source)
  throw Error("Supply the directory containing the six source GLBs.");
const out = new URL(
  "../../public/assets/environments/stylized-valley/",
  import.meta.url,
);
await fs.mkdir(out, { recursive: true });
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  });
const doc = new Document(),
  buffer = doc.createBuffer(),
  scene = doc.createScene("Stylized lake clearing");
let seed = 37;
const rand = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296;
const sources = {
  birch: "https://static.poly.pizza/457b2397-4bfb-41c4-862d-82d1592b2a5f.glb",
  pine: "https://static.poly.pizza/42a2a958-040d-4ce3-bae5-2332c1282cb5.glb",
  rocks: "https://static.poly.pizza/01671e28-0504-4db1-a5d5-af71ce0a6a1e.glb",
  bush: "https://static.poly.pizza/029d08a8-f7de-47ab-b00f-34970698ce21.glb",
  grass: "https://static.poly.pizza/99357ca2-6364-4990-8d4c-9bc5a1a5e859.glb",
  flowers: "https://static.poly.pizza/c25cb5dc-3cd3-470c-a08c-045af0c0fe3d.glb",
};
const selected = {
  birch: ["BirchTree_4", "BirchTree_5"],
  pine: ["PineTree_5", "PineTree_3"],
  rocks: ["Rock_1", "Rock_2", "Rock_4"],
  bush: ["Plant_Flowers"],
  grass: ["Grass_Small"],
  flowers: ["Flower_4_Clump", "Flower_5_Clump"],
};
const meshes = new Map();
for (const [pack, names] of Object.entries(selected)) {
  const original = await io.read(path.join(source, pack + ".glb"));
  if (pack === "birch")
    await original.transform(
      simplify({ simplifier: MeshoptSimplifier, ratio: 0.7, error: 0.002 }),
    );
  const originals = original
    .getRoot()
    .listMeshes()
    .filter((mesh) => names.includes(mesh.getName()));
  const copied = copyToDocument(doc, original, originals);
  for (const mesh of originals) meshes.set(mesh.getName(), copied.get(mesh));
}
for (const material of doc.getRoot().listMaterials()) {
  if (/Leaves/.test(material.getName()))
    material.setBaseColorFactor([0.65, 0.9, 0.62, 1]);
  material.setMetallicFactor(0).setRoughnessFactor(0.9).setNormalTexture(null);
  if (material.getAlphaMode() === "BLEND")
    material.setAlphaMode("MASK").setAlphaCutoff(0.45).setDoubleSided(true);
}
function asset(name, x, z, height, rotation = 0, y = -0.012, width = 1) {
  const mesh = meshes.get(name);
  if (!mesh) throw Error("Missing " + name);
  const mins = mesh
    .listPrimitives()
    .map((p) => p.getAttribute("POSITION").getMin([]));
  const maxs = mesh
    .listPrimitives()
    .map((p) => p.getAttribute("POSITION").getMax([]));
  const lo = [0, 1, 2].map((i) => Math.min(...mins.map((m) => m[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...maxs.map((m) => m[i])));
  // The FBX-derived source geometry is Z-up and contains layout offsets.
  const scale = height / (hi[2] - lo[2]);
  const parent = doc
    .createNode(name)
    .setTranslation([x, y, z])
    .setRotation([0, Math.sin(rotation / 2), 0, Math.cos(rotation / 2)]);
  const node = doc
    .createNode()
    .setMesh(mesh)
    .setScale([scale * width, scale * width, scale])
    .setRotation([-Math.SQRT1_2, 0, 0, Math.SQRT1_2])
    .setTranslation([
      (-(lo[0] + hi[0]) / 2) * scale * width,
      -lo[2] * scale,
      ((lo[1] + hi[1]) / 2) * scale * width,
    ]);
  parent.addChild(node);
  scene.addChild(parent);
}
const trees = [];
for (const side of [-1, 1]) {
  for (let i = 0; i < 7; i++) {
    const x = side * (2.8 + rand() * 5),
      z = -6 - i * 2.7,
      h = 3.3 + rand() * 2.4;
    asset(
      i % 3 === 0 ? "BirchTree_4" : i % 2 ? "PineTree_5" : "PineTree_3",
      x,
      z,
      h,
      rand() * 6.28,
    );
    trees.push([x, z, h]);
  }
}
for (let i = 0; i < 7; i++) {
  const x = (i - 3) * 2.7;
  asset(
    i % 2 ? "BirchTree_5" : "PineTree_5",
    x,
    -22 - rand() * 3,
    3.5 + rand() * 2,
    rand() * 6.28,
  );
}
// Rounded textured rocks frame the lake from the middle distance.
for (const side of [-1, 1])
  for (let i = 0; i < 4; i++)
    asset(
      i % 2 ? "Rock_2" : "Rock_4",
      side * (6.8 + i * 0.9),
      -12 - i * 2,
      2.1 + rand() * 2.2,
      rand() * 6.28,
      -0.1,
      1.2,
    );
for (let i = 0; i < 18; i++) {
  const side = i % 2 ? 1 : -1;
  asset(
    i % 3 ? "Rock_1" : "Rock_2",
    side * (2.1 + rand() * 4),
    2 - rand() * 7,
    0.25 + rand() * 0.5,
    rand() * 6.28,
    -0.04,
  );
}
for (let i = 0; i < 30; i++) {
  const x = (i % 2 ? 1 : -1) * (1.0 + rand() * 4),
    z = 2.8 - rand() * 10;
  asset(
    i % 4 === 0 ? "Plant_Flowers" : "Grass_Small",
    x,
    z,
    i % 4 === 0 ? 0.45 + rand() * 0.35 : 0.18 + rand() * 0.25,
    rand() * 6.28,
  );
}
for (let i = 0; i < 18; i++)
  asset(
    i % 2 ? "Flower_4_Clump" : "Flower_5_Clump",
    (i % 2 ? 1 : -1) * (1.0 + rand() * 1.8),
    2.5 - rand() * 6,
    0.17 + rand() * 0.16,
    rand() * 6.28,
  );
function accessor(type, array) {
  return doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
}
function geometry(g, name, material) {
  const p = doc.createPrimitive().setMaterial(material);
  for (const [attr, gltf, type] of [
    ["position", "POSITION", "VEC3"],
    ["normal", "NORMAL", "VEC3"],
    ["uv", "TEXCOORD_0", "VEC2"],
    ["color", "COLOR_0", "VEC3"],
  ])
    if (g.getAttribute(attr))
      p.setAttribute(
        gltf,
        accessor(type, new Float32Array(g.getAttribute(attr).array)),
      );
  if (g.index) p.setIndices(accessor("SCALAR", new Uint16Array(g.index.array)));
  scene.addChild(
    doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(p)),
  );
  g.dispose();
}
function material(name, color, roughness = 1) {
  const c = new THREE.Color(color);
  return doc
    .createMaterial(name)
    .setBaseColorFactor([c.r, c.g, c.b, 1])
    .setRoughnessFactor(roughness)
    .setMetallicFactor(0);
}
// A continuous softly shaded shore, with a recessed lake rather than a blue floor.
const ground = new THREE.PlaneGeometry(90, 90, 60, 60);
ground.rotateX(-Math.PI / 2);
ground.translate(0, 0, -20);
const pos = ground.getAttribute("position"),
  uv = ground.getAttribute("uv"),
  colors = [];
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i),
    z = pos.getZ(i),
    lake = Math.hypot(x / 5.8, (z + 14) / 7.6);
  const elevation =
    lake < 1.04
      ? -0.3
      : -0.025 +
        (Math.sin(x * 0.23) * Math.sin(z * 0.19) + 1) *
          0.07 *
          Math.min(1, Math.abs(z) / 7);
  pos.setY(i, Math.hypot(x, z) < 2.8 ? -0.025 : elevation);
  uv.setXY(i, x * 0.18, z * 0.18);
  const path = Math.exp(-((x * x) / 3 + (z * z) / 18));
  let shade = 1;
  for (const [tx, tz, h] of trees)
    shade -=
      0.22 *
      Math.exp(-((x - tx - h * 0.2) ** 2 + (z - tz + h * 0.12) ** 2) / 3);
  const c = new THREE.Color("#91ac64")
    .lerp(new THREE.Color("#b5a37a"), path * 0.6)
    .multiplyScalar(Math.max(0.5, shade) * (0.93 + rand() * 0.1));
  colors.push(c.r, c.g, c.b);
}
ground.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
ground.computeVertexNormals();
// One reusable ground texture adds fine detail without large terrain maps.
const pixels = Buffer.alloc(256 * 256 * 3);
for (let i = 0; i < 256 * 256; i++) {
  const v = Math.round(222 + rand() * 28);
  pixels[i * 3] = v;
  pixels[i * 3 + 1] = v;
  pixels[i * 3 + 2] = v;
}
const turf = doc
  .createTexture("Fine turf")
  .setImage(
    await sharp(pixels, { raw: { width: 256, height: 256, channels: 3 } })
      .jpeg({ quality: 65 })
      .toBuffer(),
  )
  .setMimeType("image/jpeg");
const gm = material("Painted clearing", "#ffffff");
gm.setBaseColorTexture(turf);
geometry(ground, "Shore", gm);
const water = new THREE.CircleGeometry(1, 64);
water.rotateX(-Math.PI / 2);
water.scale(5.6, 1, 7.4);
water.translate(0, -0.08, -14);
geometry(water, "Lake", material("Turquoise lake", "#62b4bf", 0.32));
// Stylized shoreline foam and ripples, batched into one small mesh.
const ripplePositions = [],
  rippleNormals = [];
function strip(points, width) {
  for (let i = 0; i < points.length - 1; i++)
    for (const [j, offset] of [
      [i, -1],
      [i + 1, -1],
      [i + 1, 1],
      [i, -1],
      [i + 1, 1],
      [i, 1],
    ]) {
      ripplePositions.push(points[j][0], -0.074, points[j][1] + offset * width);
      rippleNormals.push(0, 1, 0);
    }
}
for (let i = 0; i < 18; i++) {
  const z = -8 - rand() * 10,
    x = (rand() - 0.5) * 8,
    length = 0.3 + rand() * 1.3;
  strip(
    [
      [x, z],
      [x + length * 0.5, z + 0.04],
      [x + length, z],
    ],
    0.012,
  );
}
const rg = new THREE.BufferGeometry()
  .setAttribute(
    "position",
    new THREE.Float32BufferAttribute(ripplePositions, 3),
  )
  .setAttribute("normal", new THREE.Float32BufferAttribute(rippleNormals, 3));
geometry(rg, "Lake highlights", material("Water highlights", "#b6e2dc"));
for (let i = 0; i < 9; i++) {
  const h = 5 + rand() * 6,
    mountain = new THREE.ConeGeometry(1, 1, 7, 1);
  mountain.scale(6, h, 5);
  mountain.translate((i - 4) * 7, h / 2 - 0.2, -39 - rand() * 7);
  geometry(
    mountain,
    "Distant ridge",
    material("Distant blue ridge", i % 2 ? "#83b3bd" : "#92bfcb"),
  );
}
// A small waterfall and weathered arch add a landmark beyond the clearing.
asset("Rock_4", -4.8, -18, 5, 0.3, -0.05, 1.7);
const falls = new THREE.PlaneGeometry(0.52, 3.7);
falls.translate(-3.7, 1.85, -17.55);
geometry(falls, "Waterfall", material("Waterfall blue", "#a0dce1"));
const stream = new THREE.PlaneGeometry(0.13, 3.7);
stream.translate(-3.65, 1.85, -17.54);
geometry(
  stream,
  "Waterfall highlight",
  material("Water highlights", "#b6e2dc"),
);
for (const x of [-5.3, -4.25]) {
  const pillar = new THREE.BoxGeometry(0.26, 1.3, 0.35);
  pillar.translate(x, 5.25, -18);
  geometry(pillar, "Weathered arch", material("Warm stone", "#b4b29b"));
}
const arch = new THREE.BoxGeometry(1.32, 0.24, 0.38);
arch.translate(-4.775, 5.9, -18);
geometry(arch, "Weathered arch", material("Warm stone", "#b4b29b"));
// Texture conversion is build-time only. Alpha-tested foliage avoids sorting and
// retains leaf shapes; normal maps are omitted to keep decoding and GPU use low.
await doc.transform(prune(), dedup(), flatten(), join(), weld(), unpartition());
for (const texture of doc.getRoot().listTextures()) {
  const image = sharp(texture.getImage()).resize(256, 256, { fit: "inside" });
  if (/Leaves|Flowers/i.test(texture.getName()))
    texture
      .setImage(
        await image
          .png({ palette: true, colours: 128, dither: 0.5 })
          .toBuffer(),
      )
      .setMimeType("image/png");
  else
    texture
      .setImage(await image.removeAlpha().jpeg({ quality: 76 }).toBuffer())
      .setMimeType("image/jpeg");
}
await doc.transform(dedup(), prune());
// Keep an uncompressed validation copy outside the repository when requested.
if (process.env.VALLEY_QA_PATH) await io.write(process.env.VALLEY_QA_PATH, doc);
await MeshoptEncoder.ready;
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
const bytes = await io.writeBinary(doc);
await fs.writeFile(new URL("valley.glb", out), bytes);
const primitives = doc
  .getRoot()
  .listMeshes()
  .flatMap((m) => m.listPrimitives());
const manifest = {
  name: "Textured stylized valley",
  author: "Quaternius (nature assets); Rebyters (composition, terrain, lake)",
  license: "CC0-1.0 (source assets)",
  source: "https://quaternius.com/packs/ultimatestylizednature.html",
  sources,
  selected,
  bytes: bytes.length,
  triangles: primitives.reduce(
    (n, p) =>
      n +
      (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3,
    0,
  ),
  drawCalls: primitives.length,
  textures: doc
    .getRoot()
    .listTextures()
    .map((t) => ({
      name: t.getName(),
      size: t.getSize(),
      bytes: t.getImage().length,
    })),
  compression: "EXT_meshopt_compression",
  seed: 37,
};
await fs.writeFile(
  new URL("manifest.json", out),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(manifest);
