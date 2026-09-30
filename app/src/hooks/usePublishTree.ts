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
  return { busy, status, error, run, writer, publish };
}
