import { useConnection } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useEffect, useState } from "react";
import { BALANCE_EVENT } from "../lib/economy/token";
import { useRebytersAuth } from "../lib/rebyters/auth";

/** The connected wallet's SOL, refreshed every 30 s, on focus and after any game purchase. */
export function useSolBalance(): { sol: number; loading: boolean } {
  const { connection } = useConnection();
  const owner = useRebytersAuth().publicKey;
  const [state, setState] = useState({ sol: 0, loading: !!owner });
  useEffect(() => {
    if (!owner) {
      setState({ sol: 0, loading: false });
      return;
    }
    let dead = false;
    const read = async () => {
      try {
        const lamports = await connection.getBalance(owner, "confirmed");
        if (!dead) setState({ sol: lamports / LAMPORTS_PER_SOL, loading: false });
      } catch {
        if (!dead) setState((s) => ({ ...s, loading: false }));
      }
    };
    void read();
    const timer = window.setInterval(read, 30_000);
    window.addEventListener(BALANCE_EVENT, read);
    window.addEventListener("focus", read);
    return () => {
      dead = true;
      window.clearInterval(timer);
      window.removeEventListener(BALANCE_EVENT, read);
      window.removeEventListener("focus", read);
    };
  }, [connection, owner]);
  return state;
}
