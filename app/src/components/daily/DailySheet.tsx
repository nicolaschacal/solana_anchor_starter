import { Check, Gift, Sparkles, X } from "lucide-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useState } from "react";
import { FoodArt } from "../store/FoodArt";
import { claimDailyRation, claimQuest } from "../../lib/economy/actions";
import { DEPLOYMENT } from "../../lib/economy/deployment";
import { secondsToReset } from "../../lib/economy/quests";
import { formatGems, SPARKS, type GemBalance } from "../../lib/economy/token";
import { useRebytersAuth } from "../../lib/rebyters/auth";
import type { Daily } from "../../hooks/useDaily";

const FOODS = ["Meat", "Plants", "Fish", "Fruit"];

function countdown(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Daily ration and the three daily quests. Everything it shows is read from, and paid by, the chain. */
export function DailySheet({ daily, sparks, onClose }: { daily: Daily; sparks: GemBalance; onClose: () => void }) {
  const { connection } = useConnection();
  const anchorWallet = useRebytersAuth().anchorWallet;
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const run = async (key: string, job: () => Promise<unknown>) => {
    if (!anchorWallet) {
      setError("Connect your wallet first");
      return;
    }
    setBusy(key);
    setError("");
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message.slice(0, 160) : "Something went wrong");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="game-sheet-backdrop" onClick={onClose}>
      <section className="game-sheet daily-sheet" role="dialog" aria-modal="true" aria-label="Daily" onClick={(e) => e.stopPropagation()}>
        <div className="game-sheet-head">
          <div>
            <small>EVERY DAY</small>
            <h2>Daily rewards</h2>
          </div>
          <button className="ui-close" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </div>

        <div className="store-balance" role="status">
          <span className="store-coin spark" aria-hidden="true">
            <Sparkles />
          </span>
          <span className="store-balance-copy">
            <small>Your Sparks</small>
            <strong>
              {sparks.loading ? "…" : formatGems(sparks.amount)} <em>{SPARKS.symbol}</em>
            </strong>
          </span>
          <span className="store-soon">Resets in {countdown(secondsToReset(daily.now))}</span>
        </div>

        {!daily.available ? (
          <p className="daily-note">Daily rewards are not open on this network yet.</p>
        ) : (
          <>
            <article className="daily-ration">
              <div className="daily-foods" aria-hidden="true">
                {FOODS.map((_, i) => (
                  <FoodArt key={i} food={i} size={38} />
                ))}
              </div>
              <div className="daily-copy">
                <strong>Daily ration</strong>
                <small>{DEPLOYMENT.rationUnits} of each food, free, once per day</small>
              </div>
              <button
                className="ui-btn ui-btn-primary store-buy"
                disabled={!daily.rationReady || !!busy}
                onClick={() => run("ration", () => claimDailyRation(connection, anchorWallet!, daily.hasDaily))}
              >
                {busy === "ration" ? "Claiming…" : daily.rationReady ? (<><Gift aria-hidden="true" /> Claim</>) : (<><Check aria-hidden="true" /> Claimed</>)}
              </button>
            </article>

            <div className="daily-quests">
              {daily.quests.map((q) => (
                <article key={q.slot} className={`daily-quest${q.claimed ? " claimed" : ""}`}>
                  <div className="daily-copy">
                    <strong>{q.title}</strong>
                    <div className="daily-bar" aria-label={`${q.progress} of ${q.target}`}>
                      <i style={{ width: `${(q.progress / q.target) * 100}%` }} />
                    </div>
                    <small>
                      {q.progress}/{q.target} · +{q.reward} {SPARKS.symbol}
                    </small>
                  </div>
                  <button
                    className="ui-btn ui-btn-primary store-buy"
                    disabled={!q.done || q.claimed || !!busy}
                    onClick={() => run(`q${q.slot}`, () => claimQuest(connection, anchorWallet!, q.slot, daily.hasDaily))}
                  >
                    {q.claimed ? (<><Check aria-hidden="true" /> Done</>) : busy === `q${q.slot}` ? "Claiming…" : q.done ? "Claim" : "In progress"}
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
        {error && <p className="daily-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}
