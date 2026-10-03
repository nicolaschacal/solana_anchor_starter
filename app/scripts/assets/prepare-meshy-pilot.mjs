// Reproducible animation authoring for the supplied SmartRig model only.
// Usage: node scripts/assets/prepare-meshy-pilot.mjs SOURCE.glb OUTPUT.glb
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, resample, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import { Quaternion, Vector3, Matrix4 } from "three";
const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require("sharp");
} catch {
  sharp = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/sharp");
}
const [source, output] = process.argv.slice(2);
if (!source || !output)
  throw Error("Pass source and output GLB paths. Requires sharp.");
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.encoder": MeshoptEncoder,
    "meshopt.decoder": MeshoptDecoder,
  });
const doc = await io.read(source),
  root = doc.getRoot(),
  buffer = root.listBuffers()[0];
const nodes = Object.fromEntries(root.listNodes().map((n) => [n.getName(), n]));
for (const name of [
  "SmartRigArmature",
  "Bone_000",
  "Bone_001",
  "Bone_007",
  "Bone_009",
  "Bone_012",
  "Bone_015",
  "Bone_018",
  "Bone_021",
])
  if (!nodes[name]) throw Error("Not the reviewed pilot rig: " + name);
if (root.listAnimations().length)
  throw Error("Source already has animations; refusing to overwrite.");
const inputBytes = (await fs.stat(source)).size;
const textureReport = [];
for (const texture of root.listTextures()) {
  const image = texture.getImage();
  const meta = await sharp(image).metadata();
  // Keep color at 512px JPEG (opaque RGB); preserve data map losslessly at 128px.
  const isColor = root
    .listMaterials()
    .some((m) => m.getBaseColorTexture() === texture);
  const pipeline = sharp(image).resize({
    width: isColor ? 512 : 128,
    height: isColor ? 512 : 128,
    fit: "inside",
    withoutEnlargement: true,
  });
  const resized = await (
    isColor
      ? pipeline.jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      : pipeline.png({ compressionLevel: 9 })
  ).toBuffer();
  texture.setImage(resized).setMimeType(isColor ? "image/jpeg" : "image/png");
  textureReport.push({
    name: texture.getName(),
    original: [meta.width, meta.height],
    bytes: resized.length,
  });
}
const motions = {
  idle: 4,
  feed: 2.4,
  play: 2.4,
  train: 2.4,
  care: 2.4,
  touch: 1.2,
};
function channel(anim, node, path, times, values, type) {
  const input = doc
    .createAccessor()
    .setType("SCALAR")
    .setArray(new Float32Array(times))
    .setBuffer(buffer);
  const output = doc
    .createAccessor()
    .setType(type)
    .setArray(new Float32Array(values))
    .setBuffer(buffer);
  const sampler = doc
    .createAnimationSampler()
    .setInput(input)
    .setOutput(output)
    .setInterpolation("LINEAR");
  anim
    .addSampler(sampler)
    .addChannel(
      doc
        .createAnimationChannel()
        .setTargetNode(node)
        .setTargetPath(path)
        .setSampler(sampler),
    );
}
function rotation(anim, name, axis, angle, times) {
  const node = nodes[name],
    rest = new Quaternion(...node.getRotation());
  const parent = node.getParentNode();
  const parentQ = parent
    ? new Quaternion().setFromRotationMatrix(
        new Matrix4().fromArray(parent.getWorldMatrix()),
      )
    : new Quaternion();
  const localAxis = new Vector3(...axis)
    .applyQuaternion(parentQ.invert())
    .normalize();
  const vals = times.flatMap((_, i) =>
    new Quaternion()
      .setFromAxisAngle(localAxis, angle(i / (times.length - 1)))
      .multiply(rest)
      .normalize()
      .toArray(),
  );
  channel(anim, node, "rotation", times, vals, "VEC4");
}
for (const [action, duration] of Object.entries(motions)) {
  const anim = doc.createAnimation(action),
    times = Array.from({ length: 49 }, (_, i) => (duration * i) / 48);
  const p = (u) => Math.sin(Math.PI * u) ** 2,
    w = (u, n = 1) => Math.sin(2 * Math.PI * n * u);
  const bounce = (u) =>
    action === "play"
      ? 0.18 * Math.sin(2 * Math.PI * u) ** 2
      : action === "train"
        ? 0.065 * Math.sin(4 * Math.PI * u) ** 2
        : action === "touch"
          ? 0.09 * p(u)
          : 0;
  channel(
    anim,
    nodes.SmartRigArmature,
    "translation",
    times,
    times.flatMap((_, i) => [0, bounce(i / 48), 0]),
    "VEC3",
  );
  channel(
    anim,
    nodes.SmartRigArmature,
    "scale",
    times,
    times.flatMap((_, i) => {
      const u = i / 48;
      const s =
        action === "idle"
          ? 0.009 * w(u)
          : action === "feed"
            ? -0.025 * p(u)
            : action === "touch"
              ? -0.035 * p(u) * w(u)
              : 0;
      return [1 - s * 0.35, 1 + s, 1 - s * 0.35];
    }),
    "VEC3",
  );
  rotation(
    anim,
    "SmartRigArmature",
    [0, 0, 1],
    (u) =>
      action === "play"
        ? 0.075 * w(u) * p(u)
        : action === "care"
          ? 0.045 * w(u) * p(u)
          : action === "touch"
            ? 0.045 * w(u) * p(u)
            : 0,
    times,
  );
  // Bone_001 controls the main face/body. No jaw/eyelid weights exist in this rig.
  rotation(
    anim,
    "Bone_001",
    [1, 0, 0],
    (u) =>
      action === "feed"
        ? 0.09 * p(u) + 0.018 * w(u, 3) * p(u)
        : action === "care"
          ? -0.025 * p(u)
          : action === "touch"
            ? -0.035 * p(u)
            : 0.008 * w(u),
    times,
  );
  for (const [name, side] of [
    ["Bone_007", 1],
    ["Bone_009", -1],
  ])
    rotation(
      anim,
      name,
      [0, 0, 1],
      (u) =>
        side *
        (action === "touch"
          ? 0.19 * w(u, 2) * p(u)
          : action === "care"
            ? 0.1 * w(u) * p(u)
            : action === "idle"
              ? 0.025 * w(u)
              : 0.045 * w(u, 2) * p(u)),
      times,
    );
  for (const [name, side] of [
    ["Bone_012", 1],
    ["Bone_015", -1],
    ["Bone_018", -1],
    ["Bone_021", 1],
  ])
    rotation(
      anim,
      name,
      [1, 0, 0],
      (u) =>
        action === "train"
          ? side * 0.14 * w(u, 2) * p(u)
          : action === "play"
            ? side * 0.07 * w(u) * p(u)
            : 0,
      times,
    );
}
await doc.transform(
  dedup(),
  prune(),
  resample(),
  meshopt({ encoder: MeshoptEncoder, level: "medium" }),
);
const binary = await io.writeBinary(doc);
if (binary.length > 300000)
  throw Error("Budget exceeded: " + binary.length + " bytes");
await fs.writeFile(output, binary);
const verify = await io.read(output);
console.log(
  JSON.stringify(
    {
      sourceBytes: inputBytes,
      outputBytes: binary.length,
      textures: textureReport,
      clips: verify
        .getRoot()
        .listAnimations()
        .map((a) => a.getName()),
      bones: verify.getRoot().listSkins()[0].listJoints().length,
    },
    null,
    2,
  ),
);
