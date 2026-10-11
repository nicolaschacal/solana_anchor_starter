// Reduces a heavy GLB (e.g. from Meshy) to a mobile-sized prop: welds and simplifies the mesh
// (keeping the texture seams intact), keeps the base-colour and normal maps (WebP), quantizes and
// Meshopt-compresses. The normal map keeps the fine detail the simplified mesh no longer has.
//
// Usage: node scripts/assets/reduce-prop.mjs INPUT.glb OUTPUT.glb [triangles=12000] [textureSize=1024]
// Optional: GLOW="x0,x1,y0,y1" (fractions of the model's box) paints an emissive map from the
// bright pixels of the triangles inside that box, so that part glows like the vending machine's screen.
// GLOW_STRENGTH sets how strongly (default 2).
import fs from "node:fs";
import { createRequire } from "node:module";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRMaterialsEmissiveStrength } from "@gltf-transform/extensions";
import { dedup, prune, weld, simplify, quantize, meshopt, textureCompress } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const [input, output, tris = "12000", texSize = "1024"] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: reduce-prop.mjs INPUT.glb OUTPUT.glb [triangles] [textureSize]");

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
  material.setOcclusionTexture(null).setEmissiveTexture(null).setMetallicRoughnessTexture(null);
  material.setMetallicFactor(0).setRoughnessFactor(0.85).setEmissiveFactor([0, 0, 0]);
}
await doc.transform(
  prune(),
  weld(),
  // Locked borders keep the texture seams from tearing, which is what makes a simplified mesh look like spaghetti.
  simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, Number(tris) / before), error: 0.02, lockBorder: true }),
  dedup(),
  prune(),
);

if (process.env.GLOW) await paintGlow(doc, process.env.GLOW.split(",").map(Number), Number(process.env.GLOW_STRENGTH ?? 2));

await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [Number(texSize), Number(texSize)], quality: 85 }),
  quantize(),
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
);
const out = Buffer.from(await io.writeBinary(doc));
fs.writeFileSync(output, out);
console.log(`${before} -> ${count()} triangles, ${(fs.statSync(input).size / 1024).toFixed(0)} KB -> ${(out.length / 1024).toFixed(0)} KB`);

/** Emissive map = the base colour's bright pixels, only on triangles inside the given box fractions. */
async function paintGlow(doc, [x0, x1, y0, y1], strength) {
  const material = doc.getRoot().listMaterials()[0];
  const baseTex = material.getBaseColorTexture();
  const size = 1024;
  const { data } = await sharp(Buffer.from(baseTex.getImage())).resize(size, size, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(size * size * 4);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const pos = prim.getAttribute("POSITION");
  const uv = prim.getAttribute("TEXCOORD_0");
  const idx = prim.getIndices();
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let n = 0; n < pos.getCount(); n++) {
    const p = pos.getElement(n, []);
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  }
  const frac = (p) => [(p[0] - min[0]) / (max[0] - min[0]), (p[1] - min[1]) / (max[1] - min[1])];
  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  let painted = 0;
  for (let t = 0; t < idx.getCount(); t += 3) {
    const ids = [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)];
    const ps = ids.map((i) => pos.getElement(i, []));
    const c = frac([(ps[0][0] + ps[1][0] + ps[2][0]) / 3, (ps[0][1] + ps[1][1] + ps[2][1]) / 3]);
    if (c[0] < x0 || c[0] > x1 || c[1] < y0 || c[1] > y1) continue;
    const q = ids.map((i) => uv.getElement(i, []).map((v, k) => v * size));
    const minX = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0])) - 1), maxX = Math.min(size - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0])) + 1);
    const minY = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1])) - 1), maxY = Math.min(size - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])) + 1);
    const den = (q[1][1] - q[2][1]) * (q[0][0] - q[2][0]) + (q[2][0] - q[1][0]) * (q[0][1] - q[2][1]);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const a = ((q[1][1] - q[2][1]) * (px - q[2][0]) + (q[2][0] - q[1][0]) * (py - q[2][1])) / den;
      const b = ((q[2][1] - q[0][1]) * (px - q[2][0]) + (q[0][0] - q[2][0]) * (py - q[2][1])) / den;
      const g = 1 - a - b, e = -0.05;
      if (a < e || b < e || g < e) continue;
      const o = (y * size + x) * 4;
      const luma = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
      const k = smooth(0.45, 0.8, luma);
      out[o] = data[o] * k; out[o + 1] = data[o + 1] * k; out[o + 2] = data[o + 2] * k;
      painted++;
    }
  }
  const png = await sharp(out, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
  const emissive = doc.createTexture("emissive").setImage(new Uint8Array(png)).setMimeType("image/png");
  material.setEmissiveTexture(emissive).setEmissiveFactor([1, 1, 1]);
  const ext = doc.createExtension(KHRMaterialsEmissiveStrength);
  material.setExtension("KHR_materials_emissive_strength", ext.createEmissiveStrength().setEmissiveStrength(strength));
  console.log(`glow painted on ${painted} texels`);
}
