import type { Evolution, EvolutionAssets } from "./types";
import type { Uploader } from "./irys";

export interface EvolutionAssetPublication {
  assets: EvolutionAssets;
  imageUri: string;
  metadataUri: string;
}

function receiptUri(gateway: string, id: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid Irys receipt");
  return `${gateway.replace(/\/$/, "")}/${id}`;
}

export function evolutionMetadata(
  evolution: Evolution,
  imageUri: string,
  imageContentType: string,
) {
  // Keep the off-chain document deliberately conventional. Wallets and NFT
  // indexers have broad support for the Metaplex-style JSON shape even when
  // the on-chain asset itself uses native Token-2022 MetadataPointer +
  // TokenMetadata. Rebyter gameplay state/DNA stays exclusively on-chain.
  return {
    name: evolution.name,
    symbol: "RBYT",
    description: evolution.description ?? evolution.visualDescription ?? "",
    seller_fee_basis_points: 0,
    image: imageUri,
    ...((evolution.assets?.modelUri || evolution.modelUri) ? {animation_url: evolution.assets?.modelUri || evolution.modelUri} : {}),
    attributes: [
      { trait_type: "Evolution ID", value: evolution.id },
      { trait_type: "Stage", value: evolution.stage },
      { trait_type: "Family", value: evolution.family ?? "" },
      { trait_type: "Rarity", value: evolution.rarity ?? "common" },
    ],
    properties: {
      files: [{ uri: imageUri, type: imageContentType }, ...((evolution.assets?.modelUri || evolution.modelUri) ? [{uri: evolution.assets?.modelUri || evolution.modelUri, type: "model/gltf-binary"}] : [])],
      category: evolution.assets?.modelUri || evolution.modelUri ? "vr" : "image",
    },
  };
}

export async function uploadEvolutionAssetToIrys(
  evolution: Evolution,
  source: Uint8Array,
  imageContentType: string,
  uploader: Uploader,
  gateway: string,
): Promise<EvolutionAssetPublication> {
  const key = evolution.key ?? evolution.name.toLowerCase().replace(/\s+/g, "_");
  const imageReceipt = await uploader.upload(source, {
    tags: [
      { name: "Content-Type", value: imageContentType },
      { name: "App-Name", value: "Rebyters" },
      { name: "Asset-Type", value: "evolution-image" },
      { name: "Evolution-Id", value: String(evolution.id) },
      { name: "Evolution-Key", value: key },
      { name: "Stage", value: String(evolution.stage) },
    ],
  });
  const imageUri = receiptUri(gateway, imageReceipt.id);
  const metadata = evolutionMetadata(evolution, imageUri, imageContentType);
  const metadataReceipt = await uploader.upload(JSON.stringify(metadata), {
    tags: [
      { name: "Content-Type", value: "application/json" },
      { name: "App-Name", value: "Rebyters" },
      { name: "Asset-Type", value: "evolution-metadata" },
      { name: "Evolution-Id", value: String(evolution.id) },
      { name: "Evolution-Key", value: key },
      { name: "Stage", value: String(evolution.stage) },
    ],
  });
  const metadataUri = receiptUri(gateway, metadataReceipt.id);
  return {
    imageUri,
    metadataUri,
    assets: {
      ...evolution.assets,
      imageUri,
      thumbnailUri: imageUri,
      metadataUri,
    },
  };
}
