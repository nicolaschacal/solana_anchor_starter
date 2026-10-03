import type { Evolution, EvolutionAssets } from "../rebyters/types";
import type { Uploader } from "../rebyters/irys";
import { evolutionMetadata } from "../rebyters/irys-assets";
export type AssetReceipts = {
  modelUri?: string;
  imageUri?: string;
  metadataUri?: string;
};
export async function publishAssetBundle(
  evolution: Evolution,
  glb: ArrayBuffer,
  thumbnail: Blob,
  uploader: Uploader,
  gateway: string,
  receipts: AssetReceipts,
  checkpoint: (r: AssetReceipts) => Promise<void>,
  progress: (s: string) => void,
): Promise<EvolutionAssets> {
  const r = { ...receipts };
  const upload = async (
    data: string | Uint8Array,
    type: string,
    kind: string,
  ) => {
    const receipt = await uploader.upload(data, {
      tags: [
        { name: "Content-Type", value: type },
        { name: "App-Name", value: "Rebyters" },
        { name: "Asset-Type", value: kind },
        { name: "Evolution-Id", value: String(evolution.id) },
      ],
    });
    if (!/^[A-Za-z0-9_-]+$/.test(receipt.id))
      throw new Error("Invalid upload receipt");
    return `${gateway.replace(/\/$/, "")}/${receipt.id}`;
  };
  if (!r.modelUri) {
    progress("Uploading model…");
    r.modelUri = await upload(
      new Uint8Array(glb),
      "model/gltf-binary",
      "evolution-model",
    );
    await checkpoint({ ...r });
  }
  if (!r.imageUri) {
    progress("Uploading thumbnail…");
    r.imageUri = await upload(
      new Uint8Array(await thumbnail.arrayBuffer()),
      "image/png",
      "evolution-image",
    );
    await checkpoint({ ...r });
  }
  if (!r.metadataUri) {
    progress("Uploading metadata…");
    const metadata = {
      ...evolutionMetadata(evolution, r.imageUri, "image/png"),
      animation_url: r.modelUri,
      properties: {
        category: "vr",
        files: [
          { uri: r.imageUri, type: "image/png" },
          { uri: r.modelUri, type: "model/gltf-binary" },
        ],
      },
    };
    r.metadataUri = await upload(
      JSON.stringify(metadata),
      "application/json",
      "evolution-metadata",
    );
    await checkpoint({ ...r });
  }
  return { ...evolution.assets, ...r, thumbnailUri: r.imageUri };
}
