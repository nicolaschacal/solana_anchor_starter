import { useConnection } from "@solana/wallet-adapter-react";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useEffect, useMemo, useState } from "react";
import { useRebytersAuth } from "../rebyters/auth";
import { CATALOG, type StoreItem } from "./catalog";

/**
 * What the player owns, read from the wallet: every catalog item whose mint is in one of the
 * wallet's token accounts, plus the starter items every player has. Nothing is stored by the game.
 */
export type Inventory = {
  /** Units of the item in the wallet; starter items report Infinity. */
  count(item: StoreItem): number;
  loading: boolean;
};

const STARTER = Number.POSITIVE_INFINITY;

export function useInventory(): Inventory {
  const { connection } = useConnection();
  const owner = useRebytersAuth().publicKey;
  const [balances, setBalances] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const mints = useMemo(() => new Set(CATALOG.map((item) => item.mint).filter((m): m is string => !!m)), []);

  useEffect(() => {
    // No item exists on-chain yet: nothing to read.
    if (!owner || !mints.size) {
      setBalances(new Map());
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
      }
    };
    void read();
    return () => {
      dead = true;
    };
  }, [connection, owner, mints]);

  return useMemo(
    () => ({
      count: (item) => (item.starter ? STARTER : item.mint ? (balances.get(item.mint) ?? 0) : 0),
      loading,
    }),
    [balances, loading],
  );
}
