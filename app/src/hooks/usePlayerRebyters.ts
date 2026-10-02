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
  interactWithRebyter,
  evolveRebyter,
  type OnchainRebyter,
  type RebyterInteraction,
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
  const [interactingMint, setInteractingMint] = useState("");

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


  const interact = useCallback(
    async (
      mint: string,
      action: RebyterInteraction,
      foodType = 0,
    ) => {
      if (!anchorWallet) throw new Error("Connect a wallet");
      setInteractingMint(mint);
      setError("");
      setStatus(action === "feed" ? "Feeding..." : action === "play" ? "Playing..." : "Caring...");
      try {
        const signature = await interactWithRebyter(
          connection,
          anchorWallet,
          wallet,
          mint,
          action,
          foodType,
        );
        await refresh();
        setStatus(action === "feed" ? "Meal complete" : action === "play" ? "Play complete" : "Care complete");
        return signature;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        setStatus("");
        throw e;
      } finally {
        setInteractingMint("");
      }
    },
    [anchorWallet, connection, refresh, wallet],
  );


  const evolve = useCallback(
    async (mint: string, sourceId: number, targetId: number, tree: TreeJson) => {
      if (!anchorWallet) throw new Error("Connect a wallet");
      setInteractingMint(mint);
      setError("");
      setStatus("Evolving...");
      try {
        const signature = await evolveRebyter(
          connection,
          anchorWallet,
          wallet,
          mint,
          tree,
          sourceId,
          targetId,
        );
        await refresh();
        setStatus("Evolution complete");
        return signature;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        setStatus("");
        throw e;
      } finally {
        setInteractingMint("");
      }
    },
    [anchorWallet, connection, refresh, wallet],
  );

  return {
    owned,
    mammalTree,
    loading,
    creating,
    interactingMint,
    status,
    error,
    refresh,
    create,
    interact,
    evolve,
  };
}
