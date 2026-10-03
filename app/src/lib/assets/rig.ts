import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "meshoptimizer";
import dracoWrapper from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url";
import dracoWasm from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";

export const ACTIONS = [
  "idle",
  "feed",
  "play",
  "train",
  "care",
  "touch",
] as const;
export type Action = (typeof ACTIONS)[number];
export const ROLES = [
  "body",
  "head",
  "tail",
  "frontLeft",
  "frontRight",
  "backLeft",
  "backRight",
] as const;
export type Role = (typeof ROLES)[number];
export type Joint = { bone: string; axis: "x" | "y" | "z"; amount: number };
export type RigMap = Record<Role, Joint>;
export const emptyRig = (): RigMap =>
  Object.fromEntries(
    ROLES.map((role) => [
      role,
      { bone: "", axis: role === "tail" ? "y" : "x", amount: 1 },
    ]),
  ) as RigMap;
export type AssetModel = {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
  bones: THREE.Bone[];
  triangles: number;
  materials: number;
  textures: number;
};

export function loader() {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) =>
    url.endsWith("/draco_wasm_wrapper.js")
      ? dracoWrapper
      : url.endsWith("/draco_decoder.wasm")
        ? dracoWasm
        : url,
  );
  const draco = new DRACOLoader(manager)
    .setDecoderPath("/draco/")
    .setDecoderConfig({ type: "wasm" });
  return {
    gltf: new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .setDRACOLoader(draco),
    dispose: () => draco.dispose(),
  };
}
export async function parseModel(bytes: ArrayBuffer): Promise<AssetModel> {
  // GLB only. Reject external dependencies so imported projects remain portable.
  const view = new DataView(bytes);
  if (
    bytes.byteLength < 20 ||
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.byteLength
  )
    throw new Error("Import a valid, self-contained GLB 2.0 file.");
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength)),
  );
  for (const resource of [...(json.buffers || []), ...(json.images || [])]) {
    if (resource.uri && !resource.uri.startsWith("data:"))
      throw new Error(
        "GLB has external resources. Embed textures before importing.",
      );
  }
  if (json.extensionsRequired?.includes("KHR_texture_basisu"))
    throw new Error(
      "Import the original PNG/JPEG/WebP-textured GLB. KTX2 editing is not supported in this workshop yet.",
    );
  const l = loader();
  try {
    return inspectModel(await l.gltf.parseAsync(bytes, ""));
  } finally {
    l.dispose();
  }
}
export function inspectModel(gltf: GLTF): AssetModel {
  let triangles = 0;
  const bones: THREE.Bone[] = [],
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  const nodes: THREE.Object3D[] = [];
  gltf.scene.traverse((node) => {
    nodes.push(node);
    if ((node as THREE.Bone).isBone) bones.push(node as THREE.Bone);
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) {
      triangles +=
        (mesh.geometry.index?.count ??
          mesh.geometry.getAttribute("position")?.count ??
          0) / 3;
      for (const mat of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]) {
        materials.add(mat);
        for (const value of Object.values(mat))
          if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  // Bake stable names into both nodes and existing tracks before export.
  const resolved = gltf.animations.flatMap((clip) =>
    clip.tracks.map((track) => {
      const binding = THREE.PropertyBinding.parseTrackName(track.name);
      return {
        track,
        binding,
        target: THREE.PropertyBinding.findNode(gltf.scene, binding.nodeName),
      };
    }),
  );
  nodes.forEach((node, i) => {
    node.name = /^rebyter_\d+_/.test(node.name)
      ? node.name
      : `rebyter_${i}_${node.name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  });
  for (const { track, binding, target } of resolved)
    if (target && !binding.objectName)
      track.name = `${(target as THREE.Object3D).name}.${binding.propertyName}${binding.propertyIndex !== undefined ? `[${binding.propertyIndex}]` : ""}`;
  return {
    scene: gltf.scene,
    clips: gltf.animations,
    bones,
    triangles: Math.round(triangles),
    materials: materials.size,
    textures: textures.size,
  };
}
export function suggestRig(bones: THREE.Bone[]): RigMap {
  const rig = emptyRig();
  const patterns: Partial<Record<Role, RegExp>> = {
    head: /head/i,
    tail: /tail/i,
    body: /spine|chest/i,
  };
  for (const role of ROLES) {
    const matches = patterns[role]
      ? bones.filter((b) => patterns[role]!.test(b.name))
      : [];
    if (matches.length === 1) rig[role].bone = matches[0].name;
  }
  return rig;
}
export function makeClips(
  model: AssetModel,
  rig: RigMap,
  intensity: number,
  speed: number,
): THREE.AnimationClip[] {
  const selected = ROLES.map((role) => rig[role].bone).filter(Boolean);
  if (new Set(selected).size !== selected.length)
    throw new Error("Assign a different bone to each role.");
  return ACTIONS.map((action) => {
    const duration = (action === "idle" ? 4 : 2.4) / speed;
    const times = Array.from({ length: 33 }, (_, i) => (i / 32) * duration);
    const tracks: THREE.KeyframeTrack[] = [];
    for (const role of ROLES) {
      const joint = rig[role],
        bone = model.bones.find((b) => b.name === joint.bone);
      if (!bone) continue;
      const values: number[] = [];
      for (let i = 0; i < times.length; i++) {
        const u = i / 32,
          wave = Math.sin(u * Math.PI * 2),
          pulse = Math.sin(u * Math.PI) ** 2;
        let angle = 0;
        if (role === "body")
          angle =
            action === "idle"
              ? wave * 0.025
              : pulse *
                (action === "train"
                  ? 0.13
                  : action === "touch"
                    ? -0.07
                    : 0.045);
        if (role === "head")
          angle =
            action === "feed"
              ? pulse * 0.32 + Math.sin(u * Math.PI * 8) * pulse * 0.04
              : action === "care"
                ? wave * 0.1
                : wave * 0.035;
        if (role === "tail")
          angle =
            Math.sin(u * Math.PI * (action === "idle" ? 2 : 4)) *
            (action === "play" ? 0.3 : 0.13);
        if (role.startsWith("front") || role.startsWith("back"))
          angle =
            action === "train"
              ? pulse * 0.12 * (role.endsWith("Left") ? 1 : -1)
              : 0;
        const axis = new THREE.Vector3(
          joint.axis === "x" ? 1 : 0,
          joint.axis === "y" ? 1 : 0,
          joint.axis === "z" ? 1 : 0,
        );
        const q = bone.quaternion
          .clone()
          .multiply(
            new THREE.Quaternion().setFromAxisAngle(
              axis,
              angle * joint.amount * intensity,
            ),
          );
        values.push(q.x, q.y, q.z, q.w);
      }
      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          `${bone.name}.quaternion`,
          times,
          values,
        ),
      );
    }
    return new THREE.AnimationClip(action, duration, tracks);
  });
}
export async function exportGlb(
  model: AssetModel,
  clips: THREE.AnimationClip[],
): Promise<ArrayBuffer> {
  const { GLTFExporter } =
    await import("three/addons/exporters/GLTFExporter.js");
  const result = await new GLTFExporter().parseAsync(model.scene, {
    binary: true,
    animations: clips,
    onlyVisible: false,
  });
  if (!(result instanceof ArrayBuffer)) throw new Error("GLB export failed.");
  return result;
}
export function disposeModel(model: AssetModel) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>(),
    skeletons = new Set<THREE.Skeleton>();
  model.scene.traverse((node) => {
    const m = node as THREE.Mesh;
    if (!m.isMesh) return;
    geometries.add(m.geometry);
    if ((m as THREE.SkinnedMesh).isSkinnedMesh)
      skeletons.add((m as THREE.SkinnedMesh).skeleton);
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      materials.add(mat);
      for (const v of Object.values(mat))
        if (v instanceof THREE.Texture) textures.add(v);
    }
  });
  textures.forEach((t) => t.dispose());
  materials.forEach((m) => m.dispose());
  geometries.forEach((g) => g.dispose());
  skeletons.forEach((s) => s.dispose());
}
