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
