import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { SYSVAR_CLOCK_PUBKEY, type Connection } from "@solana/web3.js";
export const PERIODS = ["Night", "Morning", "Day", "Evening"] as const;
export type WorldPeriod = (typeof PERIODS)[number];
export const periodAt = (ms: number): WorldPeriod =>
  PERIODS[Math.floor(((((ms / 3600000) % 24) + 24) % 24) / 6)];
type Reference = { unix: number; monotonic: number; synced: boolean };
const references = new Map<string, Promise<Reference>>();
export function clockReference(connection: Connection) {
  let pending = references.get(connection.rpcEndpoint);
  if (!pending) {
    pending = (async () => {
      try {
        const account = await connection.getAccountInfo(
          SYSVAR_CLOCK_PUBKEY,
          "confirmed",
        );
        if (!account || account.data.length < 40)
          throw Error("Clock unavailable");
        const unix = Number(account.data.readBigInt64LE(32)) * 1000;
        if (!Number.isFinite(unix) || unix <= 0) throw Error("Invalid clock");
        return { unix, monotonic: performance.now(), synced: true };
      } catch {
        return {
          unix: Date.now(),
          monotonic: performance.now(),
          synced: false,
        };
      }
    })();
    references.set(connection.rpcEndpoint, pending);
  }
  return pending;
}
export function useWorldClock() {
  const { connection } = useConnection();
  const [clock, setClock] = useState({ now: Date.now(), synced: false });
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    void clockReference(connection).then((reference) => {
      if (cancelled) return;
      const tick = () =>
        setClock({
          now: reference.unix + performance.now() - reference.monotonic,
          synced: reference.synced,
        });
      tick();
      timer = setInterval(tick, 1000);
    });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [connection]);
  return { ...clock, period: periodAt(clock.now) };
}
