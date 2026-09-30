import type { TreeJson } from "./types";

export type ExcelSheetRow = Record<string, string | number | undefined>;

export interface EvolutionWorkbookSeed {
  nodes?: ExcelSheetRow[];
  links?: ExcelSheetRow[];
  treeName?: string;
  version?: number;
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function importEvolutionWorkbook(seed: EvolutionWorkbookSeed): TreeJson {
  const treeName = seed.treeName ?? "Mammal";
  const rows = seed.nodes ?? [];
  const nodes = rows.map((row, index) => {
    const id = asNumber(row.id ?? row.ID ?? index + 1);
    const name = String(row.name ?? row.Name ?? `Evolution ${id}`);
    const stage = asNumber(row.stage ?? row.Stage ?? 0, 0);
    const stageSafe = Math.max(0, Math.min(5, stage));
    const family = String(row.family ?? row.Family ?? treeName);
    const key = String(row.key ?? row.Key ?? name.toLowerCase().replace(/\s+/g, "_"));
    const rarity = String(row.rarity ?? row.Rarity ?? "common");
    return {
      id,
      key,
      name,
      description: String(row.description ?? row.Description ?? `${name} evolution.`),
      family,
      rarity: ["common", "uncommon", "rare", "ultra"].includes(rarity)
        ? (rarity as "common" | "uncommon" | "rare" | "ultra")
        : "common",
      stage: stageSafe,
      enabled: row.enabled === undefined ? true : Boolean(row.enabled),
      initialWeight: asNumber(row.initialWeight ?? row.InitialWeight ?? 10),
      modelUri: String(row.modelUri ?? row.model_url ?? row["Model URI"] ?? ""),
      assets: {
        metadataUri: String(row.metadataUri ?? row.metadata_url ?? row["Metadata URI"] ?? ""),
        imageUri: String(row.imageUri ?? row.image_url ?? row["Image URI"] ?? ""),
        thumbnailUri: String(row.thumbnailUri ?? row.thumbnail_url ?? row["Thumbnail URI"] ?? ""),
        modelUri: String(row.modelUri ?? row.model_url ?? row["Model URI"] ?? ""),
      },
      position: { x: asNumber(row.positionX ?? row.x ?? 0), y: asNumber(row.positionY ?? row.y ?? 0) },
      paths: [] as TreeJson["evolutions"][number]["paths"],
    };
  });

  const index = new Map(nodes.map((node) => [node.id, node]));
  for (const row of seed.links ?? []) {
    const source = asNumber(row.from ?? row.source ?? row.Source ?? 0);
    const target = asNumber(row.to ?? row.target ?? row.Target ?? 0);
    const sourceNode = index.get(source);
    const targetNode = index.get(target);
    if (!sourceNode || !targetNode) continue;
    const requiredGroupCount = asNumber(row.requiredGroupCount ?? row.required_groups ?? 1);
    const requirementArray = [] as TreeJson["evolutions"][number]["paths"][number]["requirements"];
    sourceNode.paths.push({
      target: target,
      requiredGroupCount,
      priority: asNumber(row.priority ?? 0),
      requirements: requirementArray,
    });
  }

  return {
    schema: 1,
    family: { id: 0, name: treeName },
    version: seed.version ?? 1,
    development: true,
    evolutions: nodes,
  };
}

export function importMammalSeedFromWorkbook(
  workbook: EvolutionWorkbookSeed,
): TreeJson {
  return importEvolutionWorkbook({
    ...workbook,
    treeName: workbook.treeName ?? "Mammal",
    version: workbook.version ?? 1,
  });
}
