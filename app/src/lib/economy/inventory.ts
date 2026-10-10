import { useConnection } from "@solana/wallet-adapter-react";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getTokenMetadata } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useMemo, useState } from "react";
import type { WorldLayout } from "../../components/world/layout";
import { useRebytersAuth } from "../rebyters/auth";
import { layoutFromHex } from "../rebyters/habitat-layout";
import { CATALOG, foodSlot, type StoreItem } from "./catalog";
import { DEPLOYMENT } from "./deployment";
import { fetchProfileState, type ProfileState } from "./profile";
import { BALANCE_EVENT } from "./token";

/** A habitat NFT in the wallet. Its layout is stored inside the NFT itself. */
export type OwnedHabitat = {
  mint: string;
  /** On-chain item id (see catalog). */
  itemId: number;
  name: string;
  /** The saved layout, or null while the habitat has never been laid out. */
  layout: WorldLayout | null;
};

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
  habitats: OwnedHabitat[];
  /** The habitat shown when the game opens: the profile's choice if still held, else the first one. */
  activeHabitat: OwnedHabitat | null;
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

/** Mints already known not to be habitats (Rebyters and other 1/1s never change into one). */
const notHabitat = new Set<string>();

/** The last successfully read copy of each habitat: a failed read falls back to it instead of hiding the island. */
const lastKnown = new Map<string, OwnedHabitat>();

async function readHabitats(connection: ReturnType<typeof useConnection>["connection"], candidates: PublicKey[]): Promise<{ found: OwnedHabitat[]; incomplete: boolean }> {
  const found: OwnedHabitat[] = [];
  let incomplete = false;
  const todo = candidates.filter((m) => !notHabitat.has(m.toBase58()));
  for (let n = 0; n < todo.length; n += 4) {
    const batch = todo.slice(n, n + 4);
    const results = await Promise.allSettled(
      batch.map(async (mint) => {
        // A failed read says nothing about the mint: never remember it as "not a habitat".
        const meta = await getTokenMetadata(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
        const fields = new Map(meta?.additionalMetadata ?? []);
        const kind = fields.get("HABITAT");
        if (!meta || kind === undefined || meta.symbol !== "HBTT") {
          notHabitat.add(mint.toBase58());
          return;
        }
        const habitat = { mint: mint.toBase58(), itemId: Number(kind), name: meta.name, layout: layoutFromHex(fields.get("LAYOUT")) };
        lastKnown.set(habitat.mint, habitat);
        found.push(habitat);
      }),
    );
    results.forEach((r, i) => {
      if (r.status !== "rejected") return;
      incomplete = true;
      const old = lastKnown.get(batch[i].toBase58());
      if (old) found.push(old);
    });
  }
  return { found, incomplete };
}

type Conn = ReturnType<typeof useConnection>["connection"];
type Snapshot = {
  balances: Map<string, number>;
  habitats: OwnedHabitat[];
  profile: ProfileState | null;
  empties: PublicKey[];
  loading: boolean;
  ready: boolean;
  loaded: boolean;
};
const blank = (): Snapshot => ({ balances: new Map(), habitats: [], profile: null, empties: [], loading: false, ready: false, loaded: false });

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
  const singles: PublicKey[] = [];
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
      } else if (programId.equals(TOKEN_2022_PROGRAM_ID) && info.tokenAmount?.amount === "1" && info.tokenAmount?.decimals === 0) {
        singles.push(new PublicKey(info.mint));
      }
    }
  }
  const [{ found: habitats, incomplete }, profile] = await Promise.all([readHabitats(connection, singles), fetchProfileState(connection, owner)]);
  // Some habitats could not be read: fine as long as the active one is there; otherwise read again.
  if (incomplete && !habitats.some((h) => h.mint === profile?.activeHabitat || !profile?.activeHabitat)) throw new Error("Could not read the active habitat");
  return { balances, habitats, profile, empties: idle, incomplete };
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
      const { incomplete, ...snapshot } = result;
      publish({ ...snapshot, loading: false, loaded: true, ready: true });
      if (incomplete) {
        window.clearTimeout(store.timer);
        store.timer = window.setTimeout(() => store.owner === key && refresh(connection, owner, mints, 1), 4000);
      }
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
  const { balances, habitats, profile, empties, loading, ready, loaded } = snap;

  return useMemo(() => {
    const active = habitats.find((h) => h.mint === profile?.activeHabitat) ?? habitats[0] ?? null;
    return {
      count: (item) => {
        if (item.starter) return STARTER;
        if (item.category === "food") return profile?.food[foodSlot(item.food, item.tier)] ?? 0;
        if (item.category === "habitat") {
          const id = DEPLOYMENT.items[item.id]?.itemId;
          return id === undefined ? 0 : habitats.filter((h) => h.itemId === id).length;
        }
        return item.mint ? (balances.get(item.mint) ?? 0) : 0;
      },
      food: (kind) => [0, 1, 2, 3].reduce((sum, tier) => sum + (profile?.food[foodSlot(kind, tier)] ?? 0), 0),
      meals: (kind, tier) => profile?.food[foodSlot(kind, tier)] ?? 0,
      habitats,
      activeHabitat: active,
      starterClaimed: !!profile?.starterClaimed,
      empties,
      loading,
      ready,
      loaded,
    };
  }, [balances, habitats, profile, empties, loading, ready, loaded]);
}

