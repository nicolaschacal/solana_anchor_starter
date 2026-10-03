import type { EvolutionAssets, TreeJson } from "../rebyters/types";
import type { PublishJournal } from "../rebyters/publish";
import { PROGRAM_ID, RPC_URL } from "../rebyters/config";
export const atlasDraftKey = (wallet: string, family: number, sample = false) =>
  `rebyters:draft:${RPC_URL}:${PROGRAM_ID}:${wallet}:${family}:mammal-chart-v2:${sample ? "sample" : "chain"}`;
export function mergeAssetDraft(
  source: TreeJson,
  prior: PublishJournal | null,
  id: number,
  assets: EvolutionAssets,
  active: number,
  nextVersion: number,
): PublishJournal {
  if (
    prior &&
    (prior.baseVersion !== active || prior.tree.family.id !== source.family.id)
  )
    throw new Error(
      "Atlas changed. Resolve the existing draft in Atlas before attaching assets.",
    );
  if (prior?.publication || prior?.activationSubmitted)
    throw new Error(
      "Finish or discard the pending atlas publication before editing assets.",
    );
  const tree = structuredClone(prior?.tree ?? source);
  if (!tree.evolutions.some((e) => e.id === id))
    throw new Error("Selected species is no longer in this atlas.");
  tree.version = prior?.tree.version ?? nextVersion;
  tree.evolutions = tree.evolutions.map((e) =>
    e.id === id
      ? {
          ...e,
          modelUri: assets.modelUri ?? e.modelUri,
          assets: { ...e.assets, ...assets },
        }
      : e,
  );
  return { ...prior, tree, baseVersion: active };
}
const DB = "rebyters-asset-workshop";
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("projects");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function saveProject(key: string, value: unknown) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite");
      tx.objectStore("projects").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function loadProject<T>(key: string): Promise<T | undefined> {
  const db = await database();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const r = db.transaction("projects").objectStore("projects").get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
