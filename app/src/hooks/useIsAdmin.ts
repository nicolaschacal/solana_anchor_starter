import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useRebytersAuth } from "../lib/rebyters/auth";
import { fetchRegistry } from "../lib/rebyters/registry";

const authorityCache = new Map<string, Promise<string | null>>();

/** True when the connected wallet is the registry authority, the same wallet that opens /admin. */
export function useIsAdmin() {
  const { connection } = useConnection();
  const auth = useRebytersAuth();
  const wallet = auth.publicKey?.toBase58() ?? null;
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!wallet) {
      setAdmin(false);
      return;
    }
    const key = connection.rpcEndpoint;
    let pending = authorityCache.get(key);
    if (!pending) {
      pending = fetchRegistry(connection).then((r) => r?.authority ?? null).catch(() => null);
      authorityCache.set(key, pending);
    }
    void pending.then((authority) => {
      if (!cancelled) setAdmin(!!authority && authority === wallet);
    });
    return () => {
      cancelled = true;
    };
  }, [connection, wallet]);
  return admin;
}
