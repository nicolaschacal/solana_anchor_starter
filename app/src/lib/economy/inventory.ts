import { useConnection } from "@solana/wallet-adapter-react";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useEffect, useMemo, useState } from "react";
import { useRebytersAuth } from "../rebyters/auth";
import { CATALOG, type StoreItem } from "./catalog";
import { DEPLOYMENT } from "./deployment";
import { BALANCE_EVENT } from "./token";

/**
 * What the player owns, read from the wallet: every catalog item whose mint is in one of the
 * wallet's token accounts, plus the starter items every player has. Nothing is stored by the game.
 */
export type Inventory = {
  /** Units of the item in the wallet; starter items report Infinity. */
  count(item: StoreItem): number;
  /** Meals of one kind (0 meat, 1 plants, 2 fish, 3 fruit): free-to-trade plus account-bound units. */
  food(kind: number): number;
  loading: boolean;
  /** The first read of the wallet finished (or there is nothing to read). */
  ready: boolean;
};

const STARTER = Number.POSITIVE_INFINITY;
/** Catalog ids of the account-bound foods: meat, plants, fish, fruit. */
export const BOUND_FOOD_IDS = ["spark-food-meat", "spark-food-plants", "spark-food-fish", "spark-food-fruit"];

export function useInventory(): Inventory {
  const { connection } = useConnection();
  const owner = useRebytersAuth().publicKey;
  const [balances, setBalances] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    window.addEventListener(BALANCE_EVENT, bump);
    return () => window.removeEventListener(BALANCE_EVENT, bump);
  }, []);
  const mints = useMemo(() => new Set(CATALOG.map((item) => item.mint).filter((m): m is string => !!m)), []);

  useEffect(() => {
    // No item exists on-chain yet: nothing to read.
    if (!owner || !mints.size) {
      setBalances(new Map());
      setReady(true);
      return;
    }
    let dead = false;
    setLoading(true);
    const read = async () => {
      const next = new Map<string, number>();
      for (const programId of [TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID]) {
        const accounts = await connection.getParsedTokenAccountsByOwner(owner, { programId }, "confirmed").catch(() => null);
        for (const record of accounts?.value ?? []) {
          const info = (record.account.data as { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number } } } }).parsed?.info;
          if (!info?.mint || !mints.has(info.mint)) continue;
          next.set(info.mint, (next.get(info.mint) ?? 0) + (info.tokenAmount?.uiAmount ?? 0));
        }
      }
      if (!dead) {
        setBalances(next);
        setLoading(false);
        setReady(true);
      }
    };
    void read();
    return () => {
      dead = true;
    };
  }, [connection, owner, mints, tick]);

  return useMemo(
    () => ({
      count: (item) => (item.starter ? STARTER : item.mint ? (balances.get(item.mint) ?? 0) : 0),
      food: (kind) => {
        const plain = DEPLOYMENT.foodMints[kind];
        const bound = DEPLOYMENT.items[BOUND_FOOD_IDS[kind]]?.mint;
        return (plain ? (balances.get(plain) ?? 0) : 0) + (bound ? (balances.get(bound) ?? 0) : 0);
      },
      loading,
      ready,
    }),
    [balances, loading, ready],
  );
}
