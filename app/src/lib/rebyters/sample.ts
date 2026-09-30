import mammalSeed from "./mammal.seed.json";
import type { TreeJson } from "./types";

export const MAMMAL_SEED_EVOLUTION_COUNT = mammalSeed.evolutions.length;

export function containsMammalWorkbook(tree: TreeJson): boolean {
  const keys = new Set(
    tree.evolutions.map(
      (evolution) =>
        evolution.key ?? evolution.name.toLowerCase().replace(/\s+/g, "_"),
    ),
  );
  return (
    tree.evolutions.length === mammalSeed.evolutions.length &&
    mammalSeed.evolutions.every((evolution) => keys.has(evolution.key))
  );
}

export function sampleMammal(start = 1, version = 1): TreeJson {
  const tree = structuredClone(mammalSeed) as unknown as TreeJson;
  const offset = start - 1;
  const idMap = new Map<number, number>();

  tree.evolutions.forEach((evolution, index) => {
    idMap.set(evolution.id, start + index);
  });

  tree.version = version;
  tree.evolutions = tree.evolutions.map((evolution) => ({
    ...evolution,
    id: idMap.get(evolution.id) ?? evolution.id + offset,
    paths: evolution.paths.map((path) => ({
      ...path,
      target: idMap.get(path.target) ?? path.target + offset,
    })),
  }));

  return tree;
}

export function buildMammalWorkbookUpgrade(
  start: number,
  version: number,
  previous?: TreeJson,
): TreeJson {
  const workbook = sampleMammal(start, version);
  if (!previous) return workbook;

  if (containsMammalWorkbook(previous)) {
    throw new Error("The active tree already contains this Mammal workbook.");
  }

  const reservedIds = new Set(
    previous.evolutions.map((evolution) => evolution.id),
  );
  if (workbook.evolutions.some((evolution) => reservedIds.has(evolution.id))) {
    throw new Error("Reserved workbook IDs overlap with existing identities.");
  }

  return workbook;
}


/**
 * Development migration: keep the active specimen identities/assets but replace
 * the legacy path metadata with the single structured rule schema authored in
 * the Mammal workbook. Publishing this creates the next immutable version and
 * makes it the only active ruleset used by the app/admin.
 */
export function upgradeMammalRulesInPlace(
  previous: TreeJson,
  version: number,
  start: number,
): TreeJson {
  const seed = structuredClone(mammalSeed) as unknown as TreeJson;
  const previousByKey = new Map(previous.evolutions.map(e => [e.key ?? e.name.toLowerCase().replace(/\s+/g, "_"), e]));
  const activeIdBySeedId = new Map<number, number>();

  seed.evolutions.forEach((authored, index) => {
    const current = previousByKey.get(authored.key ?? authored.name.toLowerCase().replace(/\s+/g, "_"));
    if (!current) throw new Error(`Active atlas is missing workbook specimen: ${authored.name}`);
    activeIdBySeedId.set(authored.id, start + index);
  });

  return {
    ...seed,
    version,
    development: true,
    evolutions: seed.evolutions.map((authored, index) => {
      const current = previousByKey.get(authored.key ?? authored.name.toLowerCase().replace(/\s+/g, "_"))!;
      return {
        ...authored,
        id: start + index,
        name: current.name || authored.name,
        enabled: current.enabled,
        position: current.position ?? authored.position,
        initialWeight: current.initialWeight ?? authored.initialWeight,
        modelUri: current.modelUri || authored.modelUri,
        assets: { ...authored.assets, ...current.assets },
        paths: authored.paths.map(path => ({
          ...path,
          target: activeIdBySeedId.get(path.target) ?? path.target,
        })),
      };
    }),
  };
}

export function hasStructuredMammalRules(tree: TreeJson): boolean {
  return tree.schema === 2 && !!tree.balance && tree.evolutions.every(e =>
    e.paths.every(path => !!path.rule)
  );
}
