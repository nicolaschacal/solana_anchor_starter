import { useConnection } from "@solana/wallet-adapter-react";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useMemo, useState } from "react";
import type { WorldLayout } from "../../components/world/layout";
import { useRebytersAuth } from "../rebyters/auth";
import { CATALOG, ISLAND_SIZES, foodSlot, type StoreItem } from "./catalog";
import { DEPLOYMENT } from "./deployment";
import { fetchProfileState, type ProfileState } from "./profile";
import { BALANCE_EVENT } from "./token";

/**
 * What the player owns, read from the wallet and the player's profile: decor, machines and habitat
 * NFTs from token accounts, and meals from the profile counters. Nothing is stored by the game.
 */
export type Inventory = {
  /** Units of the item; starter items report Infinity; food reports meals in stock. */
  count(item: StoreItem): number;
  /** Meals of one kind across all tiers (0 meat, 1 plants, 2 fish, 3 fruit). */
  food(kind: number): number;
  /** Meals of one kind and tier (0 plain .. 3 feast). */
  meals(kind: number, tier: number): number;
  /** The player's island: its level (0..2), side in tiles and saved layout. */
  island: { level: number; size: 5 | 7 | 9; layout: WorldLayout | null };
  /** The profile exists and the starter pack was already claimed. */
  starterClaimed: boolean;
  /** Token accounts of known items that hold 0: their rent deposit can be taken back. */
  empties: PublicKey[];
  loading: boolean;
  /** The first read of the wallet finished (or there is nothing to read). */
  ready: boolean;
  /** At least one full read of the wallet succeeded: only then is "no island" a fact rather than a failed RPC call. */
  loaded: boolean;
};

const STARTER = Number.POSITIVE_INFINITY;

type Conn = ReturnType<typeof useConnection>["connection"];
type Snapshot = {
  balances: Map<string, number>;
  profile: ProfileState | null;
  empties: PublicKey[];
  loading: boolean;
  ready: boolean;
  loaded: boolean;
};
const blank = (): Snapshot => ({ balances: new Map(), profile: null, empties: [], loading: false, ready: false, loaded: false });

/**
 * One shared read of the wallet for the whole game. Every screen used to read the chain on its own, which
 * multiplied the RPC calls, tripped rate limits, and left some screens empty while others were filled.
 */
const store = { owner: null as string | null, snap: blank(), running: false, again: false, timer: 0 };
const listeners = new Set<() => void>();
const publish = (patch: Partial<Snapshot>) => {
  store.snap = { ...store.snap, ...patch };
  listeners.forEach((fn) => fn());
};

async function readWallet(connection: Conn, owner: PublicKey, mints: Set<string>) {
  const balances = new Map<string, number>();
  const idle: PublicKey[] = [];
  for (const programId of [TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID]) {
    // A failed read must not look like an empty wallet: it would hide the island and its objects.
    const accounts = await connection.getParsedTokenAccountsByOwner(owner, { programId }, "confirmed");
    for (const record of accounts.value) {
      const info = (record.account.data as { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number; amount?: string; decimals?: number } } } }).parsed?.info;
      if (!info?.mint) continue;
      const amount = info.tokenAmount?.uiAmount ?? 0;
      if (mints.has(info.mint)) {
        balances.set(info.mint, (balances.get(info.mint) ?? 0) + amount);
        if (programId.equals(TOKEN_2022_PROGRAM_ID) && !amount) idle.push(record.pubkey);
      }
    }
  }
  // The island (level and layout) lives in the profile: one account read.
  const profile = await fetchProfileState(connection, owner);
  return { balances, profile, empties: idle };
}

/** Reads once at a time; a refresh asked for meanwhile runs right after. A failure keeps the last good state and retries. */
function refresh(connection: Conn, owner: PublicKey, mints: Set<string>, retries = 2) {
  if (store.running) {
    store.again = true;
    return;
  }
  const key = owner.toBase58();
  store.running = true;
  publish({ loading: true });
  readWallet(connection, owner, mints)
    .then((result) => {
      if (store.owner !== key) return;
      publish({ ...result, loading: false, loaded: true, ready: true });
    })
    .catch(() => {
      if (store.owner !== key) return;
      if (retries > 0) {
        window.clearTimeout(store.timer);
        store.timer = window.setTimeout(() => store.owner === key && refresh(connection, owner, mints, retries - 1), 2500);
        publish({ loading: false });
      } else publish({ loading: false, ready: true });
    })
    .finally(() => {
      store.running = false;
      if (store.again && store.owner === key) {
        store.again = false;
        refresh(connection, owner, mints);
      }
    });
}

export function useInventory(): Inventory {
  const { connection } = useConnection();
  const owner = useRebytersAuth().publicKey;
  const ownerKey = owner?.toBase58() ?? null;
  const [snap, setSnap] = useState(store.snap);
  const mints = useMemo(() => {
    const set = new Set(CATALOG.map((item) => item.mint).filter((m): m is string => !!m));
    if (DEPLOYMENT.gemMint) set.add(DEPLOYMENT.gemMint);
    return set;
  }, []);
  useEffect(() => {
    const sync = () => setSnap(store.snap);
    listeners.add(sync);
    sync();
    return () => void listeners.delete(sync);
  }, []);
  useEffect(() => {
    if (store.owner !== ownerKey) {
      // A different wallet: forget everything and read from scratch.
      window.clearTimeout(store.timer);
      store.owner = ownerKey;
      store.again = false;
      store.snap = blank();
      listeners.forEach((fn) => fn());
      if (!owner) {
        publish({ ready: true });
        return;
      }
      refresh(connection, owner, mints);
    }
  }, [connection, owner, ownerKey, mints]);
  useEffect(() => {
    const bump = () => owner && store.owner === ownerKey && refresh(connection, owner, mints);
    window.addEventListener(BALANCE_EVENT, bump);
    return () => window.removeEventListener(BALANCE_EVENT, bump);
  }, [connection, owner, ownerKey, mints]);
  const { balances, profile, empties, loading, ready, loaded } = snap;

  return useMemo(() => {
    const level = Math.min(2, profile?.islandLevel ?? 0);
    return {
      count: (item) => {
        if (item.starter) return STARTER;
        if (item.category === "food") return profile?.food[foodSlot(item.food, item.tier)] ?? 0;
        if (item.category === "habitat") return item.size <= ISLAND_SIZES[level] ? 1 : 0;
        return item.mint ? (balances.get(item.mint) ?? 0) : 0;
      },
      food: (kind) => [0, 1, 2, 3].reduce((sum, tier) => sum + (profile?.food[foodSlot(kind, tier)] ?? 0), 0),
      meals: (kind, tier) => profile?.food[foodSlot(kind, tier)] ?? 0,
      island: { level, size: ISLAND_SIZES[level], layout: profile?.layout ?? null },
      starterClaimed: !!profile?.starterClaimed,
      empties,
      loading,
      ready,
      loaded,
    };
  }, [balances, profile, empties, loading, ready, loaded]);
}

