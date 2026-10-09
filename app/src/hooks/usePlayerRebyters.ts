import type { StoreItem } from "../lib/economy/catalog";
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
const FAMILY_TREE_CACHE_TTL_MS = 5 * 60_000;

type PlayerSnapshot = {
  owned: OnchainRebyter[];
  playerProfile: PlayerProfile | null;
  mammalTree: TreeJson | null;
};

const playerSnapshotCache = new Map<string, { at: number; value: PlayerSnapshot }>();
const playerSnapshotInflight = new Map<string, Promise<PlayerSnapshot>>();
const familyTreeCache = new Map<string, { at: number; value: TreeJson }>();
const familyTreeInflight = new Map<string, Promise<TreeJson | null>>();

async function getCachedFamilyTree(
  connection: ReturnType<typeof useConnection>["connection"],
  familyId: number,
): Promise<TreeJson | null> {
  const key = `${connection.rpcEndpoint}:${familyId}`;
  const cached = familyTreeCache.get(key);
  if (cached && Date.now() - cached.at < FAMILY_TREE_CACHE_TTL_MS)
    return cached.value;

  const inflight = familyTreeInflight.get(key);
  if (inflight) return inflight;

  const promise = fetchActiveFamilyTree(connection, familyId)
    .then((family) => {
      familyTreeCache.set(key, { at: Date.now(), value: family.tree });
      return family.tree;
    })
    .catch(() => null)
    .finally(() => {
      if (familyTreeInflight.get(key) === promise)
        familyTreeInflight.delete(key);
    });

  familyTreeInflight.set(key, promise);
  return promise;
}

async function getPlayerSnapshot(
  connection: ReturnType<typeof useConnection>["connection"],
  owner: PublicKey,
  force = false,
  onOwned?: (owned: OnchainRebyter[], complete: boolean) => void,
): Promise<PlayerSnapshot> {
  const key = owner.toBase58();
  const cached = playerSnapshotCache.get(key);
  if (!force && cached && Date.now() - cached.at < PLAYER_CACHE_TTL_MS) {
    onOwned?.(cached.value.owned, true);
    return cached.value;
  }

  const pending = playerSnapshotInflight.get(key);
  if (!force && pending)
    return pending.then((value) => {
      onOwned?.(value.owned, true);
      return value;
    });

  const partialOwned = new Map<string, OnchainRebyter>();
  const ownedPromise = fetchOwnedRebyters(connection, owner, (rebyter) => {
    partialOwned.set(rebyter.mint, rebyter);
    onOwned?.([...partialOwned.values()], false);
  }).then((owned) => {
    onOwned?.(owned, true);
    return owned;
  });

  const promise = Promise.all([
    ownedPromise,
    fetchPlayerProfile(connection, owner).catch(() => null),
    getCachedFamilyTree(connection, 0),
  ]).then(([owned, playerProfile, tree]) => {
    const value: PlayerSnapshot = {
      owned,
      playerProfile,
      mammalTree: tree,
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
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [mammalTree, setMammalTree] = useState<TreeJson | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [interactingMint, setInteractingMint] = useState("");

  // The atlas is public data. Warm it while the guest/login screen is visible so
  // authentication does not have to wait for registry + Irys verification.
  useEffect(() => {
    let cancelled = false;
    void getCachedFamilyTree(connection, 0).then((tree) => {
      if (!cancelled && tree) setMammalTree(tree);
    });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  const refresh = useCallback(async (force = false) => {
    setError("");
    if (!auth.publicKey) {
      setOwned([]);
      setOwnedLoadedAll(false);
      setPlayerProfile(null);
      setProfileLoaded(false);
      return;
    }
    setLoading(true);
    try {
      const snapshot = await getPlayerSnapshot(
        connection,
        auth.publicKey,
        force,
        (earlyOwned, complete) => {
          if (complete) {
            setOwned(earlyOwned);
            setOwnedLoadedAll(true);
            return;
          }
          // Preserve already-loaded companions during a post-interaction refresh.
          // Replacing the collection with a partial RPC scan can temporarily drop
          // the selected mint and unmount the whole 3D scene.
          setOwned((current) => {
            const merged = new Map(current.map((item) => [item.mint, item]));
            for (const item of earlyOwned) merged.set(item.mint, item);
            return [...merged.values()];
          });
          setOwnedLoadedAll(false);
        },
      );
      setOwned(snapshot.owned);
      setOwnedLoadedAll(true);
      setPlayerProfile(snapshot.playerProfile);
      setProfileLoaded(true);
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
      const snapshot = await getPlayerSnapshot(
        connection,
        auth.publicKey,
        force,
        (earlyOwned, complete) => {
          if (complete) {
            setOwned(earlyOwned);
            setOwnedLoadedAll(true);
            return;
          }
          // Preserve already-loaded companions during a post-interaction refresh.
          // Replacing the collection with a partial RPC scan can temporarily drop
          // the selected mint and unmount the whole 3D scene.
          setOwned((current) => {
            const merged = new Map(current.map((item) => [item.mint, item]));
            for (const item of earlyOwned) merged.set(item.mint, item);
            return [...merged.values()];
          });
          setOwnedLoadedAll(false);
        },
      );
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
      machine?: StoreItem,
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
          machine,
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
      item?: StoreItem,
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
          item,
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
    profileLoaded,
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
