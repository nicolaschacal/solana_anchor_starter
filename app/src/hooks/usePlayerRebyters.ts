import { useCallback, useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import type { TreeJson } from "../lib/rebyters/types";
import { useRebytersAuth } from "../lib/rebyters/auth";
import type { PublicKey } from "@solana/web3.js";
import {
  createRebyter,
  fetchActiveFamilyTree,
  fetchOwnedRebyters,
  fetchPlayerProfile,
  interactWithRebyter,
  evolveRebyter,
  type OnchainRebyter,
  type PlayerProfile,
  type RebyterInteraction,
} from "../lib/rebyters/companions";

const PLAYER_CACHE_TTL_MS = 30_000;

type PlayerSnapshot = {
  owned: OnchainRebyter[];
  playerProfile: PlayerProfile | null;
  mammalTree: TreeJson | null;
};

const playerSnapshotCache = new Map<string, { at: number; value: PlayerSnapshot }>();
const playerSnapshotInflight = new Map<string, Promise<PlayerSnapshot>>();

async function getPlayerSnapshot(
  connection: ReturnType<typeof useConnection>["connection"],
  owner: PublicKey,
  force = false,
): Promise<PlayerSnapshot> {
  const key = owner.toBase58();
  const cached = playerSnapshotCache.get(key);
  if (!force && cached && Date.now() - cached.at < PLAYER_CACHE_TTL_MS) return cached.value;

  const pending = playerSnapshotInflight.get(key);
  if (!force && pending) return pending;

  const promise = Promise.all([
    fetchOwnedRebyters(connection, owner),
    fetchPlayerProfile(connection, owner).catch(() => null),
    fetchActiveFamilyTree(connection, 0).catch(() => null),
  ]).then(([owned, playerProfile, family]) => {
    const value: PlayerSnapshot = {
      owned,
      playerProfile,
      mammalTree: family?.tree ?? null,
    };
    playerSnapshotCache.set(key, { at: Date.now(), value });
    return value;
  }).finally(() => {
    if (playerSnapshotInflight.get(key) === promise) playerSnapshotInflight.delete(key);
  });

  playerSnapshotInflight.set(key, promise);
  return promise;
}

function invalidatePlayerSnapshot(owner: string | undefined) {
  if (owner) playerSnapshotCache.delete(owner);
}

export function usePlayerRebyters() {
  const { connection } = useConnection();
  const auth = useRebytersAuth();
  const wallet = auth.wallet;
  const anchorWallet = auth.anchorWallet;
  const [owned, setOwned] = useState<OnchainRebyter[]>([]);
  const [ownedLoadedAll, setOwnedLoadedAll] = useState(false);
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile | null>(null);
  const [mammalTree, setMammalTree] = useState<TreeJson | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [interactingMint, setInteractingMint] = useState("");

  const refresh = useCallback(async (force = false) => {
    setError("");
    if (!auth.publicKey) {
      setOwned([]);
      setOwnedLoadedAll(false);
      setPlayerProfile(null);
      return;
    }
    setLoading(true);
    try {
      const snapshot = await getPlayerSnapshot(connection, auth.publicKey, force);
      setOwned(snapshot.owned);
      setOwnedLoadedAll(true);
      setPlayerProfile(snapshot.playerProfile);
      if (snapshot.mammalTree) setMammalTree(snapshot.mammalTree);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOwned([]);
      setOwnedLoadedAll(false);
    } finally {
      setLoading(false);
    }
  }, [connection, auth.publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadAll = useCallback(async (force = false) => {
    if (!auth.publicKey) {
      setOwned([]);
      setOwnedLoadedAll(false);
      return [];
    }
    setLoading(true);
    setError("");
    try {
      const snapshot = await getPlayerSnapshot(connection, auth.publicKey, force);
      setOwned(snapshot.owned);
      setOwnedLoadedAll(true);
      setPlayerProfile(snapshot.playerProfile);
      if (snapshot.mammalTree) setMammalTree(snapshot.mammalTree);
      return snapshot.owned;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [connection, auth.publicKey]);

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
        invalidatePlayerSnapshot(auth.publicKey?.toBase58());
        await refresh(true);
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
      option = 0,
    ) => {
      if (!anchorWallet) throw new Error("Connect a wallet");
      setInteractingMint(mint);
      setError("");
      setStatus(
        action === "feed" ? "Feeding..."
        : action === "play" ? "Playing..."
        : action === "care" ? "Caring..."
        : action === "rest" ? "Resting..."
        : "Training..."
      );
      try {
        const signature = await interactWithRebyter(
          connection,
          anchorWallet,
          wallet,
          mint,
          action,
          option,
        );
        invalidatePlayerSnapshot(auth.publicKey?.toBase58());
        await refresh(true);
        setStatus(
          action === "feed" ? "Meal complete"
          : action === "play" ? "Play complete"
          : action === "care" ? "Care complete"
          : action === "rest" ? "Rest complete"
          : "Training complete"
        );
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
    async (
      mint: string,
      sourceId: number,
      targetId: number,
      tree: TreeJson,
    ) => {
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
        invalidatePlayerSnapshot(auth.publicKey?.toBase58());
        await refresh(true);
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
    ownedLoadedAll,
    playerProfile,
    mammalTree,
    loading,
    creating,
    interactingMint,
    status,
    error,
    refresh,
    loadAll,
    create,
    interact,
    evolve,
  };
}
