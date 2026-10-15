import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { foodModelUrl } from "../../lib/economy/foodAssets";
import type { Entity } from "./entity";

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D>>();

/** A meal's model, scaled so its longest side is 1. Cached: later throws clone it. */
async function loadFood(food: number, tier: number) {
  const url = foodModelUrl(food, tier);
  let pending = cache.get(url);
  if (!pending) {
    pending = loader.loadAsync(url).then((gltf) => {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const holder = new THREE.Group();
      gltf.scene.position.sub(centre);
      gltf.scene.scale.setScalar(1 / Math.max(size.x, size.y, size.z, 1e-3));
      gltf.scene.position.multiplyScalar(gltf.scene.scale.x);
      holder.add(gltf.scene);
      return holder;
    });
    cache.set(url, pending);
  }
  return (await pending).clone(true);
}

export type FoodFx = {
  /** Advances the meal; returns false once it is gone. */
  update: (dt: number) => boolean;
  /** Tells the meal how long the eating animation lasts, so it vanishes with it. */
  eat: (seconds: number) => void;
  cancel: () => void;
};

const THROW = 0.7;

/**
 * Throws a meal at a rebyter from the camera's side, lets it hang at the mouth while `eat` is
 * running, and shrinks it away bite by bite. `onLand` is when the eating animation should start.
 */
export async function throwFood(scene: THREE.Scene, entity: Entity, yaw: number, food: number, tier: number, onLand: () => void): Promise<FoodFx | null> {
  let obj: THREE.Object3D;
  try {
    obj = await loadFood(food, tier);
  } catch {
    return null;
  }
  const h = entity.height;
  const size = THREE.MathUtils.clamp(h * 0.55, 0.38, 0.95);
  const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const base = entity.outer.position;
  // Thrown from in front, at about chest height, as if someone standing there tossed it.
  const from = base.clone().addScaledVector(fwd, 3.2).setY(base.y + h * 0.75);
  // Stops just in front of the mouth, so the bite happens before it, never inside the body.
  const to = base.clone().addScaledVector(fwd, Math.max(0.45, h * 0.36)).setY(base.y + h * 0.45);
  obj.scale.setScalar(size);
  obj.position.copy(from);
  scene.add(obj);
  let t = 0;
  let eatFor = 0;
  let eatT = 0;
  let landed = false;
  let dead = false;
  const spin = (Math.random() > 0.5 ? 1 : -1) * 6;
  const remove = () => {
    dead = true;
    scene.remove(obj);
  };
  return {
    eat: (s) => (eatFor = s),
    cancel: remove,
    update(dt) {
      if (dead) return false;
      if (!landed) {
        t += dt;
        const k = Math.min(1, t / THROW);
        obj.position.lerpVectors(from, to, k);
        obj.position.y += Math.sin(k * Math.PI) * h * 0.35;
        obj.rotation.x += dt * spin;
        if (k >= 1) {
          landed = true;
          obj.rotation.set(0, yaw, 0);
          onLand();
        }
        return true;
      }
      eatT += dt;
      const total = Math.max(0.5, eatFor || 1.2) * 0.38;
      const k = Math.min(1, eatT / total);
      // Bitten away in a few steps, with a little shake at each bite.
      const bites = Math.ceil(k * 4) / 4;
      const shake = Math.sin(eatT * 30) * 0.02 * (1 - k);
      obj.position.copy(to);
      obj.position.x += shake;
      obj.scale.setScalar(size * Math.max(0.001, 1 - bites * 0.97 + (bites - k) * 0.25));
      obj.position.addScaledVector(fwd, -k * h * 0.12);
      if (k >= 1) {
        remove();
        return false;
      }
      return true;
    },
  };
}
