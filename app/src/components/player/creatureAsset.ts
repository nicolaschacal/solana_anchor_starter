import * as THREE from "three";
import { loader } from "../../lib/assets/rig";
import { modelUriFor } from "../../lib/assets/catalog";
import type { FxAsset } from "../../lib/rebyters/evolution-fx";
import type { Evolution } from "../../lib/rebyters/types";
import { loadCreatureImage } from "./creatureImage";
import { SPRITE_VIEWS } from "../world/entity";

/** A flat card of the creature's art, for forms that do not ship a 3D model yet. */
function spriteCard(image: HTMLImageElement): FxAsset {
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  const aspect = (image.naturalWidth || image.width || 1) / (image.naturalHeight || image.height || 1);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  return { scene: new THREE.Mesh(new THREE.PlaneGeometry(aspect, 1), material) };
}

function textureOf(url: string) {
  return new THREE.TextureLoader().loadAsync(url).then((texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  });
}

/** A 2D creature with front / side / back frames: one card whose picture follows where it walks. */
async function directionalCard(views: NonNullable<NonNullable<Evolution["assets"]>["spriteViews"]>): Promise<FxAsset> {
  const [front, side, back] = await Promise.all([textureOf(views.front), textureOf(views.side), textureOf(views.back)]);
  const image = front.image as HTMLImageElement;
  const aspect = (image.naturalWidth || image.width || 1) / (image.naturalHeight || image.height || 1);
  const material = new THREE.MeshStandardMaterial({ map: front, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 });
  const card = new THREE.Mesh(new THREE.PlaneGeometry(aspect, 1), material);
  SPRITE_VIEWS.set(card, { front, side, back });
  return { scene: card };
}

/**
 * The same model the game shows for a form (published atlas URI first, then the
 * bundled one). When a form has no model, or it fails to load, its sprite is
 * used so the evolution still plays.
 */
export async function loadEvolutionAsset(evolution: Evolution): Promise<FxAsset> {
  if (evolution.assets?.spriteViews) {
    try {
      return await directionalCard(evolution.assets.spriteViews);
    } catch {
      // Fall through to the model / flat card.
    }
  }
  const uri = modelUriFor(evolution);
  if (uri) {
    const l = loader();
    try {
      const url = uri.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${uri.slice(7)}` : uri;
      const gltf = await l.gltf.loadAsync(url);
      return { scene: gltf.scene, clips: gltf.animations };
    } catch {
      // Fall through to the sprite card.
    } finally {
      l.dispose();
    }
  }
  return spriteCard(await loadCreatureImage(evolution));
}

/**
 * What a new Rebyter is born from: a small glowing egg of DNA that stands where
 * the previous body stands in an evolution. It dissolves into the helix like one.
 */
export function birthSeed(): FxAsset {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#8fe3ff"),
    emissive: new THREE.Color("#2f86f0"),
    emissiveIntensity: 0.6,
    roughness: 0.35,
  });
  const egg = new THREE.Mesh(new THREE.SphereGeometry(0.5, 48, 32), material);
  egg.scale.set(0.8, 1.15, 0.8);
  return { scene: egg };
}
