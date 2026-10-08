import * as THREE from "three";
import { loader } from "../../lib/assets/rig";
import { modelUriFor } from "../../lib/assets/catalog";
import { EvolutionFx, type FxAsset } from "../../lib/rebyters/evolution-fx";
import type { Evolution } from "../../lib/rebyters/types";
import { loadCreatureImage } from "./creatureImage";

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

/**
 * The same model the game shows for a form (published atlas URI first, then the
 * bundled one). When a form has no model, or it fails to load, its sprite is
 * used so the evolution still plays.
 */
export async function loadEvolutionAsset(evolution: Evolution): Promise<FxAsset> {
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
 * One evolution, built ahead of time: its models are loaded, sampled and its
 * shaders compiled on a detached canvas, so that playing it is instant.
 */
export type EvolutionSession = {
  key: string;
  canvas: HTMLCanvasElement;
  /** Resolves once the scene is ready to draw; rejects when WebGL or the models are unavailable. */
  ready: Promise<EvolutionFx>;
  dispose: () => void;
};

export function createEvolutionSession(from: Evolution, to: Evolution): EvolutionSession {
  const canvas = document.createElement("canvas");
  let disposed = false;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const ready = Promise.all([loadEvolutionAsset(from), loadEvolutionAsset(to)]).then(([a, b]) => {
    const fx = new EvolutionFx(
      canvas,
      { from: a, to: b },
      { fromStage: from.stage, toStage: to.stage, reducedMotion: reduced },
    );
    return fx;
  });
  ready.catch(() => undefined);
  return {
    key: `${from.id}>${to.id}`,
    canvas,
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.remove();
      ready.then((fx) => fx.dispose(), () => undefined);
    },
  };
}
