import { Keypair, type Connection } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { makeWallet } from "./passkey";

/**
 * Tester mode: open the game with `?tester=1` and it signs in with a throwaway keypair kept in this
 * browser (no wallet extension, no passkey), then asks the devnet faucet for SOL. Everything else is the
 * normal game on devnet. `?tester=reset` makes a fresh account; `?tester=off` leaves the mode.
 */
const KEY = "rebyters.tester.v1";

export function testerRequested(): boolean {
  try {
    const flag = new URLSearchParams(window.location.search).get("tester");
    if (flag === "off") {
      localStorage.removeItem(KEY);
      sessionStorage.removeItem(KEY + ".on");
      return false;
    }
    if (flag) sessionStorage.setItem(KEY + ".on", "1");
    if (flag === "reset") localStorage.removeItem(KEY);
    return sessionStorage.getItem(KEY + ".on") === "1";
  } catch {
    return false;
  }
}

export function testerWallet(): AnchorWallet {
  let keypair: Keypair | null = null;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved)));
  } catch {
    keypair = null;
  }
  if (!keypair) {
    keypair = Keypair.generate();
    try {
      localStorage.setItem(KEY, JSON.stringify(Array.from(keypair.secretKey)));
    } catch {
      // private mode: the account lasts until the tab closes
    }
  }
  return makeWallet(keypair);
}

/** Tops the tester up from the devnet faucet (it often refuses big or repeated requests, so it steps down). */
export async function fundTester(connection: Connection, wallet: AnchorWallet): Promise<{ sol: number; note: string }> {
  const read = async () => (await connection.getBalance(wallet.publicKey)) / 1e9;
  let sol = 0;
  try {
    sol = await read();
    if (sol >= 0.5) return { sol, note: "" };
  } catch {
    return { sol, note: "no connection to devnet" };
  }
  for (const amount of [2, 1, 0.5]) {
    try {
      const sig = await connection.requestAirdrop(wallet.publicKey, amount * 1e9);
      const latest = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
      return { sol: await read(), note: "" };
    } catch (e) {
      console.warn("Tester faucet:", e);
    }
  }
  return { sol, note: "The devnet faucet refused. Tap here to copy this address, then get SOL at faucet.solana.com or send some from your own wallet." };
}
