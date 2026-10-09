import { useConnection } from "@solana/wallet-adapter-react";
import { useEffect, useMemo, useState } from "react";
import { dailyPda } from "../lib/economy/actions";
import { DEPLOYMENT } from "../lib/economy/deployment";
import { gameDay, questsFor, type Quest } from "../lib/economy/quests";
import { BALANCE_EVENT } from "../lib/economy/token";
import { useRebytersAuth } from "../lib/rebyters/auth";
import { getProgram } from "../lib/rebyters/registry";

type Raw = { rationDay: number; questDay: number; counts: number[]; claimed: number };

export type QuestState = Quest & { progress: number; done: boolean; claimed: boolean };

export type Daily = {
  /** The economy exists on this network (otherwise the whole panel is "coming soon"). */
  available: boolean;
  loading: boolean;
  hasDaily: boolean;
  day: number;
  rationReady: boolean;
  quests: QuestState[];
  /** Quests that can be claimed right now. */
  claimable: number;
  now: number;
};

/** The wallet's daily account, combined with the quest table for today's UTC day. */
export function useDaily(): Daily {
  const { connection } = useConnection();
  const owner = useRebytersAuth().publicKey;
  const [raw, setRaw] = useState<Raw | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const available = !!DEPLOYMENT.sparkMint && DEPLOYMENT.foodMints.length === 4;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!owner || !available) {
      setRaw(null);
      return;
    }
    let dead = false;
    const read = async () => {
      setLoading(true);
      try {
        const account = await (getProgram(connection).account as any).playerDaily.fetchNullable(dailyPda(owner), "confirmed");
        if (dead) return;
        setRaw(
          account
            ? {
                rationDay: Number(account.rationDay),
                questDay: Number(account.questDay),
                counts: Array.from(account.counts as number[]),
                claimed: Number(account.claimed),
              }
            : null,
        );
      } catch {
        /* keep the last known state */
      } finally {
        if (!dead) setLoading(false);
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
  }, [connection, owner, available]);

  return useMemo(() => {
    const day = gameDay(now);
    // Counters and claims only belong to today if the account was last touched today.
    const today = raw && raw.questDay === day ? raw : null;
    const quests = questsFor(day).map<QuestState>((q) => {
      const progress = Math.min(today?.counts[q.kind] ?? 0, q.target);
      return { ...q, progress, done: progress >= q.target, claimed: !!today && (today.claimed & (1 << q.slot)) !== 0 };
    });
    return {
      available,
      loading,
      hasDaily: !!raw,
      day,
      rationReady: available && (raw?.rationDay ?? 0) < day,
      quests,
      claimable: quests.filter((q) => q.done && !q.claimed).length,
      now,
    };
  }, [raw, now, available, loading]);
}
