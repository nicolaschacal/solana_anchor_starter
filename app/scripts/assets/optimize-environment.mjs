// Shrinks the environment GLBs for mobile: drops the unused metallic-roughness
// map, re-encodes the colour map as WebP, quantizes and Meshopt-compresses the
// geometry. Also repairs NUL-padded JSON chunks while reading.
// Usage: node scripts/assets/optimize-environment.mjs [DIR]   (default public/assets/environment)
// Requires sharp (already installed through the toolchain).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  prune,
  quantize,
  meshopt,
  textureCompress,
} from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const dir = process.argv[2] ?? "public/assets/environment";

// Tiles that cover large screen areas keep a little more texture detail.
const TEXTURE_SIZE = {
  "grass-plain": 256,
  "grass-tile": 256,
  "dirt-transition": 256,
  "distant-mountains": 256,
  "water-center": 256,
  "water-shore-corner": 256,
  "water-shore-straight": 256,
};

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.encoder": MeshoptEncoder,
    "meshopt.decoder": MeshoptDecoder,
  });

function repairPadding(buf) {
  const jsonLength = buf.readUInt32LE(12);
  for (let i = 20 + jsonLength - 1; i >= 20 && buf[i] === 0; i--) buf[i] = 0x20;
  return buf;
}

let before = 0;
let after = 0;
for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".glb")).sort()) {
  const file = path.join(dir, name);
  const key = name.replace(/\.glb$/, "");
  const input = repairPadding(fs.readFileSync(file));
  const doc = await io.readBinary(new Uint8Array(input));
  for (const material of doc.getRoot().listMaterials()) {
    material.setMetallicRoughnessTexture(null);
    material.setMetallicFactor(0).setRoughnessFactor(1);
  }
  const size = TEXTURE_SIZE[key] ?? 128;
  await doc.transform(
    dedup(),
    prune(),
    textureCompress({
      encoder: sharp,
      targetFormat: "webp",
      resize: [size, size],
      quality: 82,
    }),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  const output = Buffer.from(await io.writeBinary(doc));
  fs.writeFileSync(file, output);
  before += input.length;
  after += output.length;
  console.log(
    `${name.padEnd(26)} ${(input.length / 1024).toFixed(0).padStart(4)} KB -> ${(output.length / 1024).toFixed(0).padStart(4)} KB`,
  );
}
console.log(
  `total ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`,
);
