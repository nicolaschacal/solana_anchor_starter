// Reduces a heavy GLB (e.g. from Meshy) to a mobile-sized prop: welds and simplifies the mesh,
// keeps only the base-colour texture (WebP), quantizes and Meshopt-compresses.
// Usage: node scripts/assets/reduce-prop.mjs INPUT.glb OUTPUT.glb [targetTriangles=6000] [textureSize=512]
import fs from "node:fs";
import { createRequire } from "node:module";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, weld, simplify, quantize, meshopt, textureCompress, resample } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const [input, output, tris = "6000", texSize = "512"] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: reduce-prop.mjs INPUT.glb OUTPUT.glb [targetTriangles] [textureSize]");

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
const doc = await io.readBinary(new Uint8Array(fs.readFileSync(input)));

const count = () => {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) n += (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3;
  return Math.round(n);
};
const before = count();
for (const material of doc.getRoot().listMaterials()) {
  material.setNormalTexture(null).setOcclusionTexture(null).setEmissiveTexture(null).setMetallicRoughnessTexture(null);
  material.setMetallicFactor(0).setRoughnessFactor(0.9).setEmissiveFactor([0, 0, 0]);
}
await doc.transform(
  prune(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, Number(tris) / before), error: 0.05, lockBorder: false }),
  dedup(),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [Number(texSize), Number(texSize)], quality: 82 }),
  quantize(),
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
);
const out = Buffer.from(await io.writeBinary(doc));
fs.writeFileSync(output, out);
console.log(`${before} -> ${count()} triangles, ${(fs.statSync(input).size / 1024).toFixed(0)} KB -> ${(out.length / 1024).toFixed(0)} KB`);
