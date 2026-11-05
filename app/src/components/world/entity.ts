import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { FxAsset } from "../../lib/rebyters/evolution-fx";
import { ONE_TILE, type Footprint } from "../../lib/world/footprint";

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
  /** The model's own largest dimension before it is fitted (for the ?debug=1 readout). */
  raw: number;
  box: [number, number, number];
  /** Tiles it covers (w across × d deep), from FORM_TILES in lib/world/footprint.ts. */
  footprint: Footprint;
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
  /** 2D directional sprite: the frames and the card that shows them. */
  sprite: { views: SpriteViews; card: THREE.Mesh; baseY: number; baseX: number } | null;
};

export type SpriteViews = { front: THREE.Texture; side: THREE.Texture; back: THREE.Texture };
/** Directional frames of a loaded card (kept aside: cloning an Object3D does not copy textures in userData). */
export const SPRITE_VIEWS = new WeakMap<THREE.Object3D, SpriteViews>();

let blobTexture: THREE.Texture | null = null;
/** A soft round contact shadow, so a flat sprite sits on the ground instead of floating. */
function blobShadow(width: number, depth: number) {
  if (!blobTexture) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(0,0,0,0.5)");
    grad.addColorStop(0.6, "rgba(0,0,0,0.3)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    blobTexture = new THREE.CanvasTexture(c);
  }
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({ map: blobTexture, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.01;
  mesh.renderOrder = -1;
  return mesh;
}

/**
 * Picks the frame of a directional sprite from where it heads relative to the camera
 * (`rel` = heading yaw − camera yaw): towards the camera shows the front, away the back,
 * sideways the profile, mirrored for the other side. Walking adds a small hop.
 */
export function faceSprite(entity: Entity, rel: number, walking: boolean, time: number) {
  const s = entity.sprite;
  if (!s) return;
  const a = Math.atan2(Math.sin(rel), Math.cos(rel));
  const abs = Math.abs(a);
  const material = s.card.material as THREE.MeshStandardMaterial;
  let map = s.views.side;
  let flip = a > 0 ? -1 : 1; // the side art faces left; heading screen-right mirrors it
  if (abs < Math.PI / 4) (map = s.views.front), (flip = 1);
  else if (abs > (3 * Math.PI) / 4) (map = s.views.back), (flip = 1);
  if (material.map !== map) material.map = map;
  s.card.scale.x = Math.abs(s.card.scale.x) * flip;
  s.card.position.x = s.baseX * flip;
  const hop = walking ? Math.abs(Math.sin(time * 9)) * 0.045 : 0;
  const breathe = walking ? 1 : 1 + Math.sin(time * 2.2) * 0.012;
  s.card.position.y = s.baseY + hop;
  s.card.scale.y = Math.abs(s.card.scale.x) * breathe;
}

/**
 * How much of its tiles a rebyter fills. Each model covers its own footprint of tiles (see
 * lib/world/footprint.ts): it is scaled so its width fits `w` tiles and its length fits `d` tiles,
 * whichever is tighter, leaving this margin so neighbours never touch. The stage plays no part.
 */
const TILE_FILL = 0.92;

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

export function buildEntity(mint: string, asset: FxAsset, footprint: Footprint = ONE_TILE): Entity {
  const root = clone(asset.scene);
  ownMaterials(root);
  const billboard = !asset.clips?.length && (asset.scene as THREE.Mesh).isMesh === true;
  const holder = new THREE.Group();
  holder.add(root);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  // Width (x) to `w` tiles and length (z) to `d` tiles; a flat card has no depth, so only its width counts.
  const fitW = (TILE_FILL * footprint.w) / Math.max(size.x, 0.001);
  const fitD = size.z > 0.01 ? (TILE_FILL * footprint.d) / size.z : Infinity;
  const scale = Math.min(fitW, fitD);
  root.scale.multiplyScalar(scale);
  root.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
  const outer = new THREE.Group();
  outer.add(root);
  outer.visible = false;
  const views = SPRITE_VIEWS.get(asset.scene);
  let sprite: Entity["sprite"] = null;
  if (views && (root as THREE.Mesh).isMesh) {
    const card = root as THREE.Mesh;
    card.castShadow = true; // alphaTest cuts the shadow to the creature's outline
    sprite = { views, card, baseY: card.position.y, baseX: card.position.x };
    outer.add(blobShadow(size.x * scale * 0.7, size.x * scale * 0.35));
  }
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
  return { mint, outer, height: size.y * scale, raw: Math.max(size.x, size.y, size.z), box: [size.x * scale, size.y * scale, size.z * scale], footprint, billboard, yaw: 0, mixer, idle, walk, walkWeight: 0, clips, action: null, sprite };
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
  touch: ["touch", "touchspin", "bouncehappy", "touchhappy", "happy"],
  sad: ["sad"],
  feed: ["feed", "feeding"],
  play: ["play", "playhappy", "bouncehappy", "touchhappy", "happy"],
  train: ["train", "attackslam", "attack", "training"],
  care: ["care", "carehappy", "bouncehappy", "touchhappy", "happy"],
};

/** When no clip has the exact name, any clip whose name contains one of these words is used (models come from different tools). */
const ACTION_WORDS: Record<string, string[]> = {
  touch: ["happy", "joy", "cheer", "bounce", "jump", "hop", "excite", "celebrat", "dance", "spin", "wave"],
  sad: ["sad", "cry", "sorrow", "unhappy"],
  feed: ["feed", "eat", "munch", "chew", "nom", "bite"],
  play: ["happy", "joy", "play", "cheer", "bounce", "jump", "hop", "excite", "celebrat", "dance", "spin", "wave"],
  train: ["attack", "slam", "punch", "strike", "hit", "train", "kick", "smash"],
  care: ["happy", "joy", "care", "love", "cheer", "bounce", "jump", "hop", "celebrat", "dance", "wave"],
};
const NOT_ACTIONS = ["idle", "walk", "run", "sad", "sleep", "rest", "death", "die"];

function findClip(entity: Entity, key: string, wanted: string[]) {
  const exact = entity.clips.find((c) => wanted.includes(normalize(c.name)));
  if (exact) return exact;
  const words = ACTION_WORDS[key] ?? [];
  const usable = entity.clips.filter((c) => {
    const n = normalize(c.name);
    return key === "sad" || !NOT_ACTIONS.some((bad) => n.includes(bad));
  });
  for (const word of words) {
    const hit = usable.find((c) => normalize(c.name).includes(word));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Plays a named action on a rebyter. "sad" loops until stopped; the rest play once and
 * call `onDone`. Returns false (and does nothing) when the model has no such clip.
 */
export function playAction(entity: Entity, name: string, onDone?: () => void) {
  const key = name === "train-power" ? "train" : name;
  const wanted = ACTION_CLIPS[key];
  const mixer = entity.mixer;
  if (!wanted || !mixer) return false;
  const clip = findClip(entity, key, wanted);
  if (!clip) {
    if (import.meta.env?.DEV) console.warn(`No "${name}" clip in`, entity.clips.map((c) => c.name));
    return false;
  }
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
