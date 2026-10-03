import type { Evolution } from "../rebyters/types";
// Reviewed pilot, assigned explicitly by the owner to mammal.exe.
// Published atlas URIs take precedence; this bundled asset also works before wallet publication.
export const MAMMAL_PILOT = {
  modelUri: "/assets/rebyters/mesh-pilot/companion.glb",
  thumbnailUri: "/assets/rebyters/mesh-pilot/thumbnail.png",
};
export function isMammalPilot(e: Evolution) {
  return (
    e.stage === 0 &&
    (e.key === "mammal.exe" || e.name.toLowerCase() === "mammal.exe")
  );
}
export function modelUriFor(e: Evolution) {
  return (
    e.assets?.modelUri ||
    e.modelUri ||
    (isMammalPilot(e) ? MAMMAL_PILOT.modelUri : "")
  );
}
