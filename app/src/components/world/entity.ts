import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { FxAsset } from "../../lib/rebyters/evolution-fx";

const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");
const IDLE = ["idle", "idleblinking"];
const WALK = ["walk", "walkquadruped", "walkbounce"];

/** A rebyter standing in the world: a group at its tile, holding the model centred on its feet. */
export type Entity = {
  mint: string;
  /** Positioned at the tile and turned to face where it walks. */
  outer: THREE.Group;
  /** Metres from the feet to the top of the head. */
  height: number;
  /** A flat card (no 3D model): it always faces the camera instead of turning. */
  billboard: boolean;
  yaw: number;
  mixer: THREE.AnimationMixer | null;
  idle: THREE.AnimationAction | null;
  walk: THREE.AnimationAction | null;
  walkWeight: number;
};

/** How tall a rebyter stands on a tile, as the editor's diorama sizes it. */
const TILE_FIT = 0.92;

function ownMaterials(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const prepare = (source: THREE.Material) => {
      const material = source.clone();
      if (material instanceof THREE.MeshStandardMaterial && !material.emissiveMap && material.emissive.getHex() === 0)
        material.emissiveIntensity = 0;
      material.needsUpdate = true;
      return material;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(prepare) : prepare(mesh.material);
  });
}

export function buildEntity(mint: string, asset: FxAsset): Entity {
  const root = clone(asset.scene);
  ownMaterials(root);
  const billboard = !asset.clips?.length && (asset.scene as THREE.Mesh).isMesh === true;
  const holder = new THREE.Group();
  holder.add(root);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const scale = TILE_FIT / Math.max(size.x, size.y, size.z, 0.001);
  root.scale.multiplyScalar(scale);
  root.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
  const outer = new THREE.Group();
  outer.add(root);
  outer.visible = false;
  let mixer: THREE.AnimationMixer | null = null;
  let idle: THREE.AnimationAction | null = null;
  let walk: THREE.AnimationAction | null = null;
  const clips = asset.clips ?? [];
  if (clips.length) {
    mixer = new THREE.AnimationMixer(root);
    const idleClip = clips.find((c) => IDLE.includes(normalize(c.name))) ?? null;
    const walkClip = clips.find((c) => WALK.includes(normalize(c.name))) ?? null;
    if (idleClip) {
      idle = mixer.clipAction(idleClip);
      idle.play();
    }
    if (walkClip) {
      walk = mixer.clipAction(walkClip);
      walk.play();
      walk.setEffectiveWeight(0);
    }
  }
  return { mint, outer, height: size.y * scale, billboard, yaw: 0, mixer, idle, walk, walkWeight: 0 };
}

/** Eases the walk and idle animations into each other. */
export function blendWalk(entity: Entity, walking: boolean, dt: number) {
  const target = walking && entity.walk ? 1 : 0;
  entity.walkWeight += (target - entity.walkWeight) * Math.min(1, dt * 7);
  entity.walk?.setEffectiveWeight(entity.walkWeight);
  entity.idle?.setEffectiveWeight(1 - entity.walkWeight);
}

export function disposeObject(root: THREE.Object3D, geometry = true) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (geometry) mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
  });
}

/** Releases a loaded asset's own geometry and textures. */
export function disposeAsset(asset: FxAsset) {
  disposeObject(asset.scene, true);
}
