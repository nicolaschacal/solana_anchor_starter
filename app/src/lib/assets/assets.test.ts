import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { emptyRig, makeClips, type AssetModel } from "./rig";
import { mergeAssetDraft } from "./drafts";
import { publishAssetBundle, type AssetReceipts } from "./publish";
import type { TreeJson } from "../rebyters/types";

const tree: TreeJson = {
  schema: 1,
  family: { id: 0, name: "Mammal" },
  version: 4,
  development: true,
  evolutions: [
    {
      id: 21,
      name: "Caniform",
      stage: 2,
      enabled: true,
      initialWeight: 10,
      modelUri: "",
      paths: [],
    },
    {
      id: 22,
      name: "Wolf",
      stage: 3,
      enabled: true,
      initialWeight: 20,
      modelUri: "",
      paths: [],
    },
  ],
};
describe("asset pipeline", () => {
  it("creates closed quaternion loops around the imported rest pose, without a sleep clip", () => {
    const head = new THREE.Bone();
    head.name = "head";
    head.quaternion.setFromEuler(new THREE.Euler(0.3, 0.4, 0.2));
    const model: AssetModel = {
      scene: new THREE.Group(),
      bones: [head],
      clips: [],
      triangles: 0,
      textures: 0,
      materials: 0,
    };
    const rig = emptyRig();
    rig.head.bone = "head";
    const clips = makeClips(model, rig, 1, 1);
    expect(clips.map((c) => c.name)).toEqual([
      "idle",
      "feed",
      "play",
      "train",
      "care",
      "touch",
    ]);
    for (const clip of clips) {
      const values = clip.tracks[0].values;
      for (let i = 0; i < 4; i++) {
        expect(values[i]).toBeCloseTo(head.quaternion.toArray()[i], 6);
        expect(values[values.length - 4 + i]).toBeCloseTo(values[i], 6);
      }
    }
    rig.tail.bone = "head";
    expect(() => makeClips(model, rig, 1, 1)).toThrow("different bone");
  });
  it("preserves unrelated atlas edits and rejects stale or partially published drafts", () => {
    const previous = { tree: structuredClone(tree), baseVersion: 4 };
    previous.tree.version = 5;
    previous.tree.evolutions[1].initialWeight = 77;
    const next = mergeAssetDraft(
      tree,
      previous,
      21,
      {
        modelUri: "https://gateway.test/model",
        thumbnailUri: "https://gateway.test/thumb",
      },
      4,
      5,
    );
    expect(next.tree.evolutions[1].initialWeight).toBe(77);
    expect(next.tree.evolutions[0].modelUri).toBe("https://gateway.test/model");
    expect(tree.evolutions[0].modelUri).toBe("");
    expect(() => mergeAssetDraft(tree, previous, 21, {}, 6, 7)).toThrow(
      "Atlas changed",
    );
    expect(() =>
      mergeAssetDraft(
        tree,
        { ...previous, activationSubmitted: true },
        21,
        {},
        4,
        5,
      ),
    ).toThrow("pending");
    expect(() => mergeAssetDraft(tree, null, 999, {}, 4, 5)).toThrow(
      "no longer",
    );
  });
  it("resumes a partial Irys upload and emits image plus 3D metadata before attaching", async () => {
    let checkpoint: AssetReceipts = {};
    const calls: string[] = [];
    const uploader = {
      upload: async (
        data: string | Uint8Array,
        options: { tags: { name: string; value: string }[] },
      ) => {
        calls.push(options.tags.find((t) => t.name === "Asset-Type")!.value);
        if (calls.length === 2) throw new Error("network");
        return { id: "model123" };
      },
    };
    await expect(
      publishAssetBundle(
        tree.evolutions[0],
        new ArrayBuffer(20),
        new Blob(["png"]),
        uploader,
        "https://gateway.test",
        {},
        async (r) => {
          checkpoint = r;
        },
        () => {},
      ),
    ).rejects.toThrow("network");
    expect(checkpoint.modelUri).toBe("https://gateway.test/model123");
    let metadata = "";
    const retry = {
      upload: async (
        data: string | Uint8Array,
        options: { tags: { name: string; value: string }[] },
      ) => {
        calls.push(options.tags.find((t) => t.name === "Asset-Type")!.value);
        if (typeof data === "string") metadata = data;
        return { id: "next123" };
      },
    };
    const assets = await publishAssetBundle(
      tree.evolutions[0],
      new ArrayBuffer(20),
      new Blob(["png"]),
      retry,
      "https://gateway.test",
      checkpoint,
      async (r) => {
        checkpoint = r;
      },
      () => {},
    );
    expect(calls.filter((c) => c === "evolution-model")).toHaveLength(1);
    expect(JSON.parse(metadata).animation_url).toBe(assets.modelUri);
    expect(assets.metadataUri).toBeTruthy();
    expect(assets.thumbnailUri).toBe(assets.imageUri);
  });
});
