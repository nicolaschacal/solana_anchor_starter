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

async function readHabitats(connection: ReturnType<typeof useConnection>["connection"], candidates: PublicKey[]): Promise<OwnedHabitat[]> {
  const found: OwnedHabitat[] = [];
  const todo = candidates.filter((m) => !notHabitat.has(m.toBase58()));
  for (let n = 0; n < todo.length; n += 6) {
    const results = await Promise.allSettled(
      todo.slice(n, n + 6).map(async (mint) => {
        // A failed read says nothing about the mint: never remember it as "not a habitat".
        const meta = await getTokenMetadata(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
        const fields = new Map(meta?.additionalMetadata ?? []);
        const kind = fields.get("HABITAT");
        if (!meta || kind === undefined || meta.symbol !== "HBTT") {
          notHabitat.add(mint.toBase58());
          return;
        }
        found.push({ mint: mint.toBase58(), itemId: Number(kind), name: meta.name, layout: layoutFromHex(fields.get("LAYOUT")) });
      }),
    );
    if (results.some((r) => r.status === "rejected")) throw new Error("Could not read every habitat");
  }
  return found;
}

export function useInventory(): Inventory {
  const { connection } = useConnection();
  const owner = useRebytersAuth().publicKey;
  const [balances, setBalances] = useState<Map<string, number>>(new Map());
  const [habitats, setHabitats] = useState<OwnedHabitat[]>([]);
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [empties, setEmpties] = useState<PublicKey[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    window.addEventListener(BALANCE_EVENT, bump);
    return () => window.removeEventListener(BALANCE_EVENT, bump);
  }, []);
  const mints = useMemo(() => {
    const set = new Set(CATALOG.map((item) => item.mint).filter((m): m is string => !!m));
    if (DEPLOYMENT.gemMint) set.add(DEPLOYMENT.gemMint);
    return set;
  }, []);

  useEffect(() => {
    if (!owner) {
      setBalances(new Map());
      setHabitats([]);
      setProfile(null);
      setEmpties([]);
      setLoaded(false);
      setReady(true);
      return;
    }
    let dead = false;
    setLoading(true);
    const read = async () => {
      const next = new Map<string, number>();
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
            next.set(info.mint, (next.get(info.mint) ?? 0) + amount);
            if (programId.equals(TOKEN_2022_PROGRAM_ID) && !amount) idle.push(record.pubkey);
          } else if (programId.equals(TOKEN_2022_PROGRAM_ID) && info.tokenAmount?.amount === "1" && info.tokenAmount?.decimals === 0) {
            singles.push(new PublicKey(info.mint));
          }
        }
      }
      const [owned, state] = await Promise.all([readHabitats(connection, singles), fetchProfileState(connection, owner)]);
      if (!dead) {
        setBalances(next);
        setHabitats(owned);
        setProfile(state);
        setEmpties(idle);
        setLoading(false);
        setLoaded(true);
        setReady(true);
      }
    };
    // On failure the last good state stays; the next tick (or the 30 s refresh events) tries again.
    const attempt = (left: number) =>
      read().catch(() => {
        if (dead) return;
        if (left > 0) window.setTimeout(() => !dead && void attempt(left - 1), 2500);
        else {
          setLoading(false);
          setReady(true);
        }
      });
    void attempt(2);
    return () => {
      dead = true;
    };
  }, [connection, owner, mints, tick]);

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

