import { useCallback, useEffect, useState } from "react";
import {
  useAnchorWallet,
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
import type { TreeJson } from "../lib/rebyters/types";
import {
  createRebyter,
  fetchActiveFamilyTree,
  fetchOwnedRebyters,
  type OnchainRebyter,
} from "../lib/rebyters/companions";

export function usePlayerRebyters() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const anchorWallet = useAnchorWallet();
  const [owned, setOwned] = useState<OnchainRebyter[]>([]);
  const [mammalTree, setMammalTree] = useState<TreeJson | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    if (!wallet.publicKey) {
      setOwned([]);
      return;
    }
    setLoading(true);
    try {
      const [records, family] = await Promise.all([
        fetchOwnedRebyters(connection, wallet.publicKey),
        fetchActiveFamilyTree(connection, 0).catch(() => null),
      ]);
      setOwned(records);
      if (family) setMammalTree(family.tree);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOwned([]);
    } finally {
      setLoading(false);
    }
  }, [connection, wallet.publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (familyId: number) => {
      if (!anchorWallet) throw new Error("Connect a wallet");
      setCreating(true);
      setError("");
      setStatus("Preparing your Rebyter...");
      try {
        const result = await createRebyter(
          connection,
          anchorWallet,
          wallet,
          familyId,
        );
        setStatus("Rebyter created");
        await refresh();
        return result;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        setStatus("");
        throw e;
      } finally {
        setCreating(false);
      }
    },
    [anchorWallet, connection, refresh, wallet],
  );

  return {
    owned,
    mammalTree,
    loading,
    creating,
    status,
    error,
    refresh,
    create,
  };
}
