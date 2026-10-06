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


export async function publishModelReplacement(
  evolution: Evolution,
  glb: ArrayBuffer,
  uploader: Uploader,
  gateway: string,
  progress: (s: string) => void,
): Promise<EvolutionAssets> {
  if (glb.byteLength > 500 * 1024)
    throw new Error(`3D model must be 500 KB or smaller (received ${Math.ceil(glb.byteLength / 1024)} KB)`);

  const imageUri = evolution.assets?.imageUri ?? evolution.assets?.thumbnailUri;
  if (!imageUri)
    throw new Error("Publish/reference an image for this Rebyter before replacing its 3D model.");

  const upload = async (data: string | Uint8Array, type: string, kind: string) => {
    const receipt = await uploader.upload(data, {
      tags: [
        { name: "Content-Type", value: type },
        { name: "App-Name", value: "Rebyters" },
        { name: "Asset-Type", value: kind },
        { name: "Evolution-Id", value: String(evolution.id) },
        { name: "Evolution-Key", value: evolution.key ?? evolution.name.toLowerCase().replace(/\s+/g, "_") },
      ],
    });
    if (!/^[A-Za-z0-9_-]+$/.test(receipt.id))
      throw new Error("Invalid upload receipt");
    return `${gateway.replace(/\/$/, "")}/${receipt.id}`;
  };

  progress("Uploading optimized 3D model…");
  const modelUri = await upload(
    new Uint8Array(glb),
    "model/gltf-binary",
    "evolution-model",
  );

  let imageContentType = "image/png";
  if (evolution.assets?.metadataUri) {
    try {
      const response = await fetch(evolution.assets.metadataUri);
      if (response.ok) {
        const metadata = await response.json() as {
          properties?: { files?: Array<{ uri?: string; type?: string }> };
        };
        imageContentType =
          metadata.properties?.files?.find((file) => file.uri === imageUri)?.type ??
          metadata.properties?.files?.[0]?.type ??
          imageContentType;
      }
    } catch {
      // Existing immutable metadata is only a hint for MIME type.
    }
  }

  const nextEvolution: Evolution = {
    ...evolution,
    modelUri,
    assets: { ...evolution.assets, modelUri },
  };
  const metadata = {
    ...evolutionMetadata(nextEvolution, imageUri, imageContentType),
    animation_url: modelUri,
    properties: {
      category: "vr",
      files: [
        { uri: imageUri, type: imageContentType },
        { uri: modelUri, type: "model/gltf-binary" },
      ],
    },
  };

  progress("Publishing updated 3D metadata…");
  const metadataUri = await upload(
    JSON.stringify(metadata),
    "application/json",
    "evolution-metadata",
  );

  progress("3D model staged for the next atlas version");
  return {
    ...evolution.assets,
    modelUri,
    metadataUri,
    imageUri,
    thumbnailUri: evolution.assets?.thumbnailUri ?? imageUri,
  };
}
