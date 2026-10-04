import { useCallback, useSyncExternalStore } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useRebytersAuth } from "../lib/rebyters/auth";
const memory = new Map<string, string>();
const event = "rebyters:selected-companion";
function read(key: string) {
  if (!key) return "";
  try {
    return memory.get(key) ?? localStorage.getItem(key) ?? "";
  } catch {
    return memory.get(key) ?? "";
  }
}
function subscribe(callback: () => void) {
  const storage = (e: StorageEvent) => {
    if (e.key) memory.delete(e.key);
    else memory.clear();
    callback();
  };
  window.addEventListener(event, callback);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(event, callback);
    window.removeEventListener("storage", storage);
  };
}
export function useSelectedRebyter() {
  const { publicKey } = useRebytersAuth();
  const { connection } = useConnection();
  const key = publicKey
    ? `rebyters:selected:${connection.rpcEndpoint}:${publicKey.toBase58()}`
    : "";
  const mint = useSyncExternalStore(
    subscribe,
    useCallback(() => read(key), [key]),
    () => "",
  );
  const select = useCallback(
    (mint: string) => {
      if (!key) return;
      memory.set(key, mint);
      try {
        localStorage.setItem(key, mint);
      } catch {
        /* Keep selection for this session when storage is unavailable. */
      }
      window.dispatchEvent(new Event(event));
    },
    [key],
  );
  return [mint, select] as const;
}
export function selectedCompanion<T extends { mint: string }>(
  owned: T[],
  mint: string,
  complete: boolean,
) {
  return (
    owned.find((item) => item.mint === mint) ??
    (!mint || complete ? owned[0] : undefined)
  );
}
