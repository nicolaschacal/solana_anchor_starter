import { useSyncExternalStore } from "react";

/**
 * Admin only: one extra, local rebyter that can be any form of the atlas. It lives in this browser,
 * is never minted and never saved on chain; it only stands in the world and in My reByters like the others.
 * The mint is a throwaway address nobody holds the key of.
 */
export const FREE_MINT = "5S93qthJ4JvRh2MoFBkrfuejRxnpiUVH7Bvhj4uMRYit";
const KEY = "rebyters.free.form";
const listeners = new Set<() => void>();

const read = (): number | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
};
let current = read();

export const getFreeForm = () => current;
export function setFreeForm(id: number | null) {
  current = id;
  try {
    if (id === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(id));
  } catch {
    // fine: it just will not survive a reload
  }
  listeners.forEach((l) => l());
}
export function useFreeForm() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}
