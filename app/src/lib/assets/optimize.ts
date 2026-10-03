import { WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, resample, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";

export async function optimizeGlb(
  source: ArrayBuffer,
  textureSize: number,
): Promise<ArrayBuffer> {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new WebIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "meshopt.encoder": MeshoptEncoder,
      "meshopt.decoder": MeshoptDecoder,
    });
  const doc = await io.readBinary(new Uint8Array(source));
  for (const texture of doc.getRoot().listTextures()) {
    const bytes = texture.getImage();
    if (!bytes) continue;
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(bytes).buffer], { type: texture.getMimeType() }),
    );
    try {
      const ratio = Math.min(
        1,
        textureSize / Math.max(bitmap.width, bitmap.height),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      canvas
        .getContext("2d")!
        .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      // PNG retains alpha and avoids introducing lossy errors into data maps.
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b ? resolve(b) : reject(new Error("Texture encoding failed")),
          "image/png",
        ),
      );
      if (ratio < 1 || blob.size < bytes.byteLength)
        texture
          .setImage(new Uint8Array(await blob.arrayBuffer()))
          .setMimeType("image/png");
    } finally {
      bitmap.close();
    }
  }
  await doc.transform(
    dedup(),
    prune(),
    resample(),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  const bytes = await io.writeBinary(doc);
  return new Uint8Array(bytes).buffer;
}
