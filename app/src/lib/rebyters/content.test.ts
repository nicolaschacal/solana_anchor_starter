import { describe, it, expect } from "vitest";
import { canonicalSerialize, contentHash } from "./canonical";
import { buildMerkleTree, leafHash, verifyEvolutionProof } from "./merkle";
import { sampleMammal } from "./sample";
import { buildMammalWorkbookUpgrade } from "./sample";
import {
  graphFromTree,
  GRAPH_STAGE_ORDER,
  immediateEvolutionNeighborhood,
} from "./graph";
import { validateTree, assertCompatible } from "./validation";
describe("canonical content and Merkle proofs", () => {
  it("sorts object keys and rejects floats", () => {
    expect(canonicalSerialize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(() => canonicalSerialize(1.1)).toThrow();
  });
  it("normalizes evolution, path and requirement order", () => {
    const a = sampleMammal(),
      b = sampleMammal();
    b.evolutions.reverse();
    b.evolutions.forEach((e) => {
      e.paths.reverse();
      e.paths.forEach((p) => { p.rule!.groups.reverse(); p.rule!.mandatory.reverse(); p.rule!.groups.forEach(g => { g.alternatives.reverse(); g.alternatives.forEach(a => { a.reverse(); a.forEach(c=>c.metrics.reverse()); }); }); });
    });
    expect(contentHash(a)).toBe(contentHash(b));
    expect(buildMerkleTree(a).root).toBe(buildMerkleTree(b).root);
  });
  it("verifies every proof including odd leaves and singleton", () => {
    for (const count of [1, 5, 6]) {
      const tree = sampleMammal();
      tree.evolutions = tree.evolutions
        .slice(0, count)
        .map((e) => ({ ...e, paths: [] }));
      const merkle = buildMerkleTree(tree);
      for (const e of tree.evolutions)
        expect(
          verifyEvolutionProof(
            tree,
            e,
            merkle.getEvolutionProof(e.id),
            merkle.root,
          ),
        ).toBe(true);
    }
  });
  it("detects modified entries, rules and family", () => {
    const tree = sampleMammal(),
      merkle = buildMerkleTree(tree),
      e = tree.evolutions[1],
      proof = merkle.getEvolutionProof(e.id);
    expect(leafHash(tree, e)).toBe(leafHash(tree, structuredClone(e)));
    expect(
      verifyEvolutionProof(tree, { ...e, name: "Changed" }, proof, merkle.root),
    ).toBe(false);
    const changed = structuredClone(e);
    changed.paths[0].rule!.mandatory.push({ metrics:["progression.cycle"], test:"min", value:10 });
    expect(verifyEvolutionProof(tree, changed, proof, merkle.root)).toBe(false);
    expect(
      verifyEvolutionProof(
        { ...tree, family: { id: 1, name: "Aquatic" } },
        e,
        proof,
        merkle.root,
      ),
    ).toBe(false);
  });
  it("changes complete content hash with version or content", () => {
    const tree = sampleMammal();
    expect(contentHash(tree)).not.toBe(contentHash({ ...tree, version: 2 }));
    const changed = structuredClone(tree);
    changed.evolutions[0].enabled = false;
    expect(contentHash(tree)).not.toBe(contentHash(changed));
  });
  it("rejects duplicate IDs, missing targets, invalid metrics and group count", () => {
    const tree = sampleMammal();
    for (const change of [
      (t: typeof tree) => {
        t.evolutions[1].id = 1;
      },
      (t: typeof tree) => {
        t.evolutions[0].paths[0].target = 99;
      },
      (t: typeof tree) => {
        t.evolutions[0].paths[0].rule!.groups[0].alternatives[0][0].metrics = ["genetics.unknown"];
      },
      (t: typeof tree) => {
        t.evolutions[0].paths[0].rule!.requiredGroups = 7;
      },
    ]) {
      const next = structuredClone(tree);
      change(next);
      expect(() => validateTree(next)).toThrow();
    }
  });
  it("preserves permanent identities", () => {
    const a = sampleMammal(),
      b = sampleMammal();
    b.evolutions[0].name = "Dragon";
    expect(() => assertCompatible(a, b)).toThrow();
  });
  it("replaces the collection with only new workbook identities", () => {
    const previous = sampleMammal();
    previous.version = 1;
    previous.evolutions = previous.evolutions
      .slice(0, 6)
      .map((evolution, index) => ({
        ...evolution,
        id: index + 1,
        name: ["Kitten", "Cat", "Lion", "Tiger", "Leopard", "Sabertooth"][
          index
        ],
        paths: [],
      }));

    const next = buildMammalWorkbookUpgrade(7, 2, previous);
    expect(next.evolutions).toHaveLength(58);
    expect(next.evolutions.every((e) => e.id >= 7 && e.enabled)).toBe(true);
    expect(next.evolutions[0].name).toBe("mammal.exe");
    expect(next.evolutions[0].id).toBe(7);
    expect(() => assertCompatible(previous, next)).toThrow();
    expect(() => validateTree(next)).not.toThrow();
    expect(() => buildMammalWorkbookUpgrade(96, 3, next)).toThrow(
      "The active tree already contains this Mammal workbook.",
    );
  });
  it("has one BIT origin and all 58 workbook forms are reachable across 85 forward links", () => {
    const tree = sampleMammal();
    expect(
      GRAPH_STAGE_ORDER.map(
        (_, stage) => tree.evolutions.filter((e) => e.stage === stage).length,
      ),
    ).toEqual([1, 4, 12, 22, 13, 6]);
    expect(tree.evolutions.reduce((n, e) => n + e.paths.length, 0)).toBe(85);
    const reached = new Set<number>();
    function visit(id: number) {
      if (reached.has(id)) return;
      reached.add(id);
      const e = tree.evolutions.find((e) => e.id === id)!;
      for (const p of e.paths) {
        expect(tree.evolutions.find((e) => e.id === p.target)!.stage).toBe(
          e.stage + 1,
        );
        visit(p.target);
      }
    }
    visit(tree.evolutions.find((e) => e.name === "mammal.exe")!.id);
    expect(reached.size).toBe(58);
    const merkle = buildMerkleTree(tree);
    for (const e of tree.evolutions)
      expect(
        verifyEvolutionProof(
          tree,
          e,
          merkle.getEvolutionProof(e.id),
          merkle.root,
        ),
      ).toBe(true);
  });
  it("builds a graph view from tree data and keeps stage order", () => {
    const tree = sampleMammal();
    const { nodes, edges } = graphFromTree(tree);
    expect(nodes.length).toBe(tree.evolutions.length);
    expect(edges.length).toBe(
      tree.evolutions.reduce((sum, e) => sum + e.paths.length, 0),
    );
    expect(GRAPH_STAGE_ORDER).toEqual([
      "BIT",
      "BYTE",
      "KYLO",
      "MEGA",
      "GIGA",
      "TERA",
    ]);
    expect(nodes[0].stage).toBe("BIT");
    expect(nodes[0].data.name).toBe(tree.evolutions[0].name);
    expect(edges[0].source).toBe(String(tree.evolutions[0].id));
  });
  it("returns only immediate incoming and outgoing evolution neighbors", () => {
    const tree = sampleMammal();
    tree.evolutions = tree.evolutions.slice(0, 5).map((evolution, index) => ({
      ...evolution,
      id: index + 1,
      paths: [],
    }));
    const path = (target: number) => ({
      target,
      requiredGroupCount: 0,
      priority: 0,
      requirements: [],
    });
    tree.evolutions[0].paths = [path(2), path(3)];
    tree.evolutions[1].paths = [path(4)];
    tree.evolutions[2].paths = [path(5)];

    expect(
      immediateEvolutionNeighborhood(tree, 2).map((evolution) => evolution.id),
    ).toEqual([1, 2, 4]);
    expect(immediateEvolutionNeighborhood(tree, 99)).toEqual([]);
  });
});
