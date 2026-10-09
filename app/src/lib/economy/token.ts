import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useState } from "react";
import { useRebytersAuth } from "../rebyters/auth";
import { DEPLOYMENT } from "./deployment";

/** The game currency. Its mint is configured once the token exists (VITE_GEM_MINT). */
export const GEMS = {
  symbol: "Gems",
  mint: parseMint((import.meta.env?.VITE_GEM_MINT as string | undefined) || DEPLOYMENT.gemMint || undefined),
};

function parseMint(value: string | undefined) {
  if (!value) return null;
  try {
    return new PublicKey(value.trim());
  } catch {
    return null;
  }
}

/** Sparks: free, account-bound quest currency. */
export const SPARKS = { symbol: "Sparks", mint: parseMint(DEPLOYMENT.sparkMint ?? undefined) };

export const BALANCE_EVENT = "rebyters:balances-changed";
/** Ask every balance hook to re-read the wallet (after a purchase or a claim). */
export const refreshBalances = () => window.dispatchEvent(new Event(BALANCE_EVENT));

/** "1.2K", "12,500", "0". Whole numbers below 10k, short above. */
export function formatGems(amount: number) {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}M`;
  if (amount >= 10_000) return `${(amount / 1000).toFixed(amount >= 100_000 ? 0 : 1)}K`;
  return Math.floor(amount).toLocaleString("en-US");
}

export type GemBalance = {
  /** The token exists and is configured. Until then purchases stay closed. */
  launched: boolean;
  /** Whole Gems in the connected wallet (0 when not connected or not launched). */
  amount: number;
  loading: boolean;
};

/** The connected wallet's Gems, refreshed every 30 s and whenever the window regains focus. */
export function useGemBalance(): GemBalance {
  return useTokenBalance(GEMS.mint);
}

/** Whole units of one token in the connected wallet. */
export function useTokenBalance(mint: PublicKey | null): GemBalance {
  const { connection } = useConnection();
  const auth = useRebytersAuth();
  const owner = auth.publicKey;
  const [state, setState] = useState<GemBalance>({ launched: !!mint, amount: 0, loading: !!mint && !!owner });

  useEffect(() => {
    if (!mint || !owner) {
      setState({ launched: !!mint, amount: 0, loading: false });
      return;
    }
    let dead = false;
    const read = async () => {
      try {
        // Works for both the classic token program and Token-2022.
        const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint }, "confirmed");
        const amount = accounts.value.reduce((sum, record) => {
          const info = (record.account.data as { parsed?: { info?: { tokenAmount?: { uiAmount?: number } } } }).parsed?.info;
          return sum + (info?.tokenAmount?.uiAmount ?? 0);
        }, 0);
        if (!dead) setState({ launched: true, amount, loading: false });
      } catch {
        if (!dead) setState((s) => ({ ...s, loading: false }));
      }
    };
    void read();
    const timer = window.setInterval(read, 30_000);
    window.addEventListener("focus", read);
    window.addEventListener(BALANCE_EVENT, read);
    return () => {
      dead = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", read);
      window.removeEventListener(BALANCE_EVENT, read);
    };
  }, [connection, owner, mint]);

  return state;
}
