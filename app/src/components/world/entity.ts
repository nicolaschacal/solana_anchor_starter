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
  clips: THREE.AnimationClip[];
  /** A one-off action (feed, play, touch…) or a mood loop (sad) is playing. */
  action: THREE.AnimationAction | null;
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
  return { mint, outer, height: size.y * scale, billboard, yaw: 0, mixer, idle, walk, walkWeight: 0, clips, action: null };
}

/** Eases the walk and idle animations into each other. */
export function blendWalk(entity: Entity, walking: boolean, dt: number) {
  const target = walking && entity.walk && !entity.action ? 1 : 0;
  entity.walkWeight += (target - entity.walkWeight) * Math.min(1, dt * 7);
  entity.walk?.setEffectiveWeight(entity.walkWeight);
  entity.idle?.setEffectiveWeight(entity.action ? 0 : 1 - entity.walkWeight);
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

const ACTION_CLIPS: Record<string, string[]> = {
  touch: ["touch", "touchspin", "bouncehappy", "happy"],
  sad: ["sad"],
  feed: ["feed", "feeding"],
  play: ["play", "playhappy", "bouncehappy", "happy"],
  train: ["train", "attackslam", "attack", "training"],
  care: ["care", "carehappy", "bouncehappy", "happy"],
};

/**
 * Plays a named action on a rebyter. "sad" loops until stopped; the rest play once and
 * call `onDone`. Returns false (and does nothing) when the model has no such clip.
 */
export function playAction(entity: Entity, name: string, onDone?: () => void) {
  const key = name === "train-power" ? "train" : name;
  const wanted = ACTION_CLIPS[key];
  const mixer = entity.mixer;
  if (!wanted || !mixer) return false;
  const clip = entity.clips.find((c) => wanted.includes(normalize(c.name)));
  if (!clip) return false;
  stopAction(entity);
  const action = mixer.clipAction(clip).reset();
  const loops = key === "sad";
  action.setLoop(loops ? THREE.LoopRepeat : THREE.LoopOnce, loops ? Infinity : 1);
  action.clampWhenFinished = true;
  action.fadeIn(0.15).play();
  entity.action = action;
  if (!loops) {
    const finished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== action) return;
      mixer.removeEventListener("finished", finished);
      if (entity.action === action) stopAction(entity);
      onDone?.();
    };
    mixer.addEventListener("finished", finished);
  }
  return true;
}

export function stopAction(entity: Entity) {
  entity.action?.fadeOut(0.2);
  entity.action = null;
}
