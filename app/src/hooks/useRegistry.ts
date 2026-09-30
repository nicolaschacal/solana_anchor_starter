import { useCallback, useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { fetchRegistry } from "../lib/rebyters/registry";
import type { Registry } from "../lib/rebyters/types";
export function useRegistry() {
  const { connection } = useConnection();
  const [registry, setRegistry] = useState<Registry | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRegistry(await fetchRegistry(connection));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [connection]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { registry, loading, error, refresh };
}
