import seed from "../../../lib/rebyters/mammal.seed.json";
import modelUris from "../../../lib/rebyters/model-uris.json";
import { modelUriFor } from "../../../lib/assets/catalog";
import type { Evolution, TreeJson } from "../../../lib/rebyters/types";

/**
 * What the start-screen tour shows. The atlas comes from the bundled design (every form), and the
 * forms that already have a 3D model carry it: published ones through model-uris.json, plus a few
 * models bundled with the site so the tour has real creatures before the rest are published.
 */
const BUNDLED: Record<string, { model: string; thumb: string }> = {
  Finbit: { model: "/showcase/finbit.glb", thumb: "/showcase/thumbs/finbit.png" },
  Cetacean: { model: "/showcase/cetacean.glb", thumb: "/showcase/thumbs/cetacean.png" },
  Chiropteran: { model: "/showcase/chiropteran.glb", thumb: "/showcase/thumbs/chiropteran.png" },
};

export const STAGE_NAMES = ["Origin", "Byte", "Kylo", "Stage 3", "Stage 4", "Stage 5"];

const published = modelUris as Record<string, { uri: string }>;

export const FORMS: Evolution[] = (seed as unknown as TreeJson).evolutions.map((form) => {
  const own = BUNDLED[form.name];
  const modelUri = own?.model ?? published[form.name.toLowerCase()]?.uri ?? modelUriFor(form);
  return {
    ...form,
    modelUri,
    assets: { ...form.assets, ...(own ? { thumbnailUri: own.thumb, modelUri: own.model } : {}) },
  };
});

export const has3d = (form: Evolution) => !!modelUriFor(form);
export const byName = (name: string) => FORMS.find((f) => f.name === name)!;
/** Forms that can stand in the world, in atlas order. */
export const SHOW_FORMS = FORMS.filter(has3d);

/** The showcase evolution: the round blue Finbit becomes the Cetacean (a path the atlas really has). */
export const EVOLVE_FROM = byName("Finbit");
export const EVOLVE_TO = byName("Cetacean");

const METRIC_LABEL: Record<string, string> = {
  "diet.meat": "Eats mostly meat",
  "diet.fish": "Eats mostly fish",
  "diet.plant": "Eats mostly vegetables",
  "diet.fruit": "Eats mostly fruit",
  "time.night": "Active at night",
  "time.day": "Active by day",
  "time.morning": "Early bird",
  "time.evening": "Evening player",
  "physical.weight": "Healthy weight",
  "battle.attack": "Strong attack",
  "care.bond": "Close bond",
  "care.mistakes": "Few care mistakes",
  "activity.play": "Loves to play",
};

/** The plain-words requirements of a path, from its rule. */
export function requirementsOf(from: Evolution, to: Evolution): string[] {
  const path = from.paths.find((p) => p.target === to.id);
  const rule = path?.rule as { groups?: { alternatives: { metrics: string[] }[][] }[] } | undefined;
  const out: string[] = [];
  for (const group of rule?.groups ?? []) {
    const metric = group.alternatives[0]?.[0]?.metrics?.[0];
    const label = metric ? METRIC_LABEL[metric] : undefined;
    if (label && !out.includes(label)) out.push(label);
  }
  return out.length ? out.slice(0, 5) : ["Eats well", "Close bond", "Strong attack"];
}
