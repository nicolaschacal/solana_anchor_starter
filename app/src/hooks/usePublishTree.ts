import { useRef, useState } from "react";
import {
  useConnection,
  useWallet,
  useAnchorWallet,
} from "@solana/wallet-adapter-react";
import type { Wallet } from "@anchor-lang/core";
import { RegistryWriter } from "../lib/rebyters/registry";
import { sendInstruction } from "../lib/rebyters/transactions";
import { publishTree, type PublishJournal } from "../lib/rebyters/publish";
import { IRYS_GATEWAY } from "../lib/rebyters/config";
import type { Evolution } from "../lib/rebyters/types";
import { uploadEvolutionAssetToIrys } from "../lib/rebyters/irys-assets";
import { publishModelReplacement } from "../lib/assets/publish";
export function usePublishTree() {
  const { connection } = useConnection(),
    wallet = useWallet(),
    anchorWallet = useAnchorWallet();
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const currentStatus = useRef("");
  function progress(message: string) {
    currentStatus.current = message;
    setStatus(message);
  }
  function writer() {
    if (!anchorWallet) throw new Error("Connect a wallet");
    return new RegistryWriter(connection, anchorWallet as Wallet, (ix) =>
      sendInstruction(connection, anchorWallet as Wallet, ix, progress),
    );
  }
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError("");
    progress("Preparing...");
    try {
      return await action();
    } catch (e) {
      setError(
        `${currentStatus.current}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  async function publishEvolutionAsset(
    evolution: Evolution,
    source: Uint8Array,
    contentType: string,
  ) {
    return run(async () => {
      progress(`Uploading ${evolution.name} image to Irys...`);
      const { browserUploader } = await import("../lib/rebyters/irys-browser");
      const uploader = await browserUploader(wallet);
      const result = await uploadEvolutionAssetToIrys(
        evolution,
        source,
        contentType,
        uploader,
        IRYS_GATEWAY,
      );
      progress(`Published ${evolution.name} image + metadata`);
      return result;
    });
  }

  async function publishEvolutionModel(
    evolution: Evolution,
    glb: ArrayBuffer,
    preview?: Blob,
  ) {
    return run(async () => {
      const { browserUploader } = await import("../lib/rebyters/irys-browser");
      const uploader = await browserUploader(wallet);
      return publishModelReplacement(
        evolution,
        glb,
        preview,
        uploader,
        IRYS_GATEWAY,
        progress,
      );
    });
  }

  async function publishLocalEvolutionAssets(evolutions: Evolution[]) {
    return run(async () => {
      const local = evolutions.filter((e) => {
        const uri = e.assets?.imageUri ?? "";
        return uri.startsWith("/");
      });
      if (!local.length) throw new Error("No local image references to publish");
      const { browserUploader } = await import("../lib/rebyters/irys-browser");
      const uploader = await browserUploader(wallet);
      const updated = new Map<number, Evolution>();
      for (let i = 0; i < local.length; i++) {
        const evolution = local[i];
        const uri = evolution.assets!.imageUri!;
        progress(`[${i + 1}/${local.length}] Uploading ${evolution.name} image...`);
        const response = await fetch(uri);
        if (!response.ok) throw new Error(`Could not load ${uri}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const contentType = response.headers.get("content-type")?.split(";")[0] || "image/svg+xml";
        const publication = await uploadEvolutionAssetToIrys(
          evolution,
          bytes,
          contentType,
          uploader,
          IRYS_GATEWAY,
        );
        updated.set(evolution.id, {
          ...evolution,
          assets: publication.assets,
        });
      }
      progress(`Published ${local.length} Rebyter asset pair${local.length === 1 ? "" : "s"} to Irys`);
      return evolutions.map((e) => updated.get(e.id) ?? e);
    });
  }

  async function publish(
    journal: PublishJournal,
    save: (j: PublishJournal) => void,
  ) {
    return run(() =>
      publishTree(
        writer(),
        journal,
        async () => {
          const { browserUploader } =
            await import("../lib/rebyters/irys-browser");
          return browserUploader(wallet);
        },
        save,
        progress,
        IRYS_GATEWAY,
      ),
    );
  }
  return {
    busy,
    status,
    error,
    run,
    writer,
    publish,
    publishEvolutionAsset,
    publishEvolutionModel,
    publishLocalEvolutionAssets,
  };
}
