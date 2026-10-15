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

/** Tops the tester up from the devnet faucet. Returns a message when it could not. */
export async function fundTester(connection: Connection, wallet: AnchorWallet): Promise<string | null> {
  try {
    const have = await connection.getBalance(wallet.publicKey);
    if (have >= 0.5e9) return null;
    const sig = await connection.requestAirdrop(wallet.publicKey, 2e9);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
    return null;
  } catch (e) {
    console.warn("Tester faucet:", e);
    return "no devnet SOL yet: faucet unavailable";
  }
}
