import type { Edge, Node } from "@xyflow/react";
import type { Evolution, TreeJson } from "./types";

export type GraphNode = Node<{ stage: string; name: string; id: number; family: string; rarity: string; description: string; thumbnailUri: string; key: string; selected?: boolean }> & {
  stage: string;
};

export const GRAPH_STAGE_ORDER = ["BIT", "BYTE", "KYLO", "MEGA", "GIGA", "TERA"] as const;

export function stageNameFromNumber(stage: number): (typeof GRAPH_STAGE_ORDER)[number] {
  return GRAPH_STAGE_ORDER[Math.max(0, Math.min(GRAPH_STAGE_ORDER.length - 1, stage))] ?? "BIT";
}

export function stageIndexFromName(stage: string): number {
  return GRAPH_STAGE_ORDER.indexOf(stage as (typeof GRAPH_STAGE_ORDER)[number]);
}

export function getEvolutionDisplayImage(evolution: Evolution): string {
  return (
    evolution.assets?.thumbnailUri ||
    evolution.assets?.imageUri ||
    "https://images.unsplash.com/photo-1543852786-1cf6624b9987?auto=format&fit=crop&w=512&q=80"
  );
}

export function graphFromTree(tree: TreeJson): {
  nodes: GraphNode[];
  edges: Edge[];
} {
  const stageCursor = new Map<string, number>();
  const nodes: GraphNode[] = tree.evolutions.map((evolution) => {
    const stage = stageNameFromNumber(evolution.stage);
    const row = stageCursor.get(stage) ?? 0;
    stageCursor.set(stage, row + 1);
    const position = evolution.position ?? {
      x: GRAPH_STAGE_ORDER.indexOf(stage) * 260 + 90,
      y: row * 150 + 90,
    };
    return {
      id: String(evolution.id),
      type: "evolutionNode",
      stage,
      position,
      data: {
        id: evolution.id,
        key: evolution.key ?? evolution.name.toLowerCase().replace(/\s+/g, "_"),
        name: evolution.name,
        stage,
        family: evolution.family ?? tree.family.name,
        rarity: evolution.rarity ?? "common",
        description: evolution.description ?? evolution.visualDescription ?? "",
        thumbnailUri: getEvolutionDisplayImage(evolution),
      },
    } as GraphNode;
  });

  const edges: Edge[] = tree.evolutions.flatMap((evolution) =>
    evolution.paths.map((path) => ({
      id: `${evolution.id}-${path.target}`,
      source: String(evolution.id),
      target: String(path.target),
      type: "smoothstep",
      label: String(path.requiredGroupCount),
      labelStyle: { fill: "#516c58", fontWeight: 600, fontSize: 10 },
      labelBgStyle: { fill: "#f3f7f3", fillOpacity: 0.9 },
      animated: true,
      style: { stroke: "#7f9d88", strokeWidth: 2 },
    })),
  );

  return { nodes, edges };
}

export function immediateEvolutionNeighborhood(
  tree: TreeJson,
  evolutionId: number,
): Evolution[] {
  const evolution = tree.evolutions.find((item) => item.id === evolutionId);
  if (!evolution) return [];

  const ids = new Set([evolutionId, ...evolution.paths.map((path) => path.target)]);
  for (const candidate of tree.evolutions) {
    if (candidate.paths.some((path) => path.target === evolutionId)) {
      ids.add(candidate.id);
    }
  }
  return tree.evolutions.filter((item) => ids.has(item.id));
}

export function fullEvolutionLineage(
  tree: TreeJson,
  evolutionId: number,
): Evolution[] {
  const byId = new Map(tree.evolutions.map((e) => [e.id, e]));
  if (!byId.has(evolutionId)) return [];

  const parents = new Map<number, number[]>();
  for (const source of tree.evolutions) {
    for (const path of source.paths) {
      const list = parents.get(path.target) ?? [];
      list.push(source.id);
      parents.set(path.target, list);
    }
  }

  const ids = new Set<number>();
  const walkBack = (id: number) => {
    if (ids.has(id)) return;
    ids.add(id);
    for (const parent of parents.get(id) ?? []) walkBack(parent);
  };
  const walkForward = (id: number) => {
    if (ids.has(id)) {
      // Still traverse children: this node may have been visited by the ancestor walk.
    } else {
      ids.add(id);
    }
    const node = byId.get(id);
    if (!node) return;
    for (const path of node.paths) {
      if (!ids.has(path.target)) {
        ids.add(path.target);
        walkForward(path.target);
      }
    }
  };

  walkBack(evolutionId);
  walkForward(evolutionId);
  return tree.evolutions.filter((e) => ids.has(e.id));
}

export function autoLayoutEvolutionTree(tree: TreeJson): TreeJson {
  const stageCursor = new Map<string, number>();
  return {
    ...tree,
    evolutions: tree.evolutions.map((evolution) => {
      const stage = stageNameFromNumber(evolution.stage);
      const row = stageCursor.get(stage) ?? 0;
      stageCursor.set(stage, row + 1);
      return {
        ...evolution,
        position: {
          x: GRAPH_STAGE_ORDER.indexOf(stage) * 260 + 90,
          y: row * 150 + 90,
        },
      };
    }),
  };
}
