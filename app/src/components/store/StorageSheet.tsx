import { Coins, PackageOpen, Sparkles, X } from "lucide-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useState } from "react";
import { ACCOUNT_RENT_LAMPORTS, reclaimRent } from "../../lib/economy/actions";
import { CATALOG, STORE_CATEGORIES, type StoreItem } from "../../lib/economy/catalog";
import type { Inventory } from "../../lib/economy/inventory";
import { GEMS, SPARKS, formatGems, type GemBalance } from "../../lib/economy/token";
import { useRebytersAuth } from "../../lib/rebyters/auth";
import { FoodArt } from "./FoodArt";
import { detailFor, iconFor } from "./StoreSheet";

const SECTION_LABEL: Record<string, string> = { habitat: "Habitats", food: "Food", machine: "Machines", decor: "Decor" };

/** Everything the wallet holds, grouped by type. Read from the wallet; nothing is stored by the game. */
export function StorageSheet({ balance, sparks, inventory, onClose }: { balance: GemBalance; sparks: GemBalance; inventory: Inventory; onClose: () => void }) {
  const { connection } = useConnection();
  const anchorWallet = useRebytersAuth().anchorWallet;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const owned = (item: StoreItem) => {
    const n = inventory.count(item);
    return n === Number.POSITIVE_INFINITY ? 0 : n;
  };
  const sections = STORE_CATEGORIES.filter((c) => c.id !== "sparks").map((c) => ({
    id: c.id,
    label: SECTION_LABEL[c.id] ?? c.label,
    items: CATALOG.filter((item) => item.category === c.id && owned(item) > 0).sort((a, b) => a.name.localeCompare(b.name)),
  }));
  const total = sections.reduce((sum, s) => sum + s.items.length, 0);
  const reclaimable = inventory.empties.length;

  const reclaim = async () => {
    if (!anchorWallet) return;
    setBusy(true);
    setNote("");
    try {
      await reclaimRent(connection, anchorWallet, inventory.empties);
      setNote(`Returned about ${((reclaimable * ACCOUNT_RENT_LAMPORTS) / 1e9).toFixed(4)} SOL to your wallet`);
    } catch {
      setNote("Couldn't reclaim. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="game-sheet-backdrop" onClick={onClose}>
      <section className="game-sheet store-sheet storage-sheet" role="dialog" aria-modal="true" aria-label="Storage" onClick={(e) => e.stopPropagation()}>
        <div className="game-sheet-head">
          <div>
            <small>YOUR WALLET</small>
            <h2>Storage</h2>
          </div>
          <button className="ui-close" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </div>

        <div className="storage-currencies">
          <span>
            <Coins aria-hidden="true" /> {balance.loading ? "…" : formatGems(balance.amount)} {GEMS.symbol}
          </span>
          {sparks.launched && (
            <span>
              <Sparkles aria-hidden="true" /> {sparks.loading ? "…" : formatGems(sparks.amount)} {SPARKS.symbol}
            </span>
          )}
        </div>

        {total === 0 && (
          <p className="storage-empty">
            <PackageOpen aria-hidden="true" /> Nothing here yet. Claim your daily ration or visit the store.
          </p>
        )}

        {sections
          .filter((s) => s.items.length)
          .map((s) => (
            <div key={s.id} className="storage-section">
              <h3>
                {s.label} <small>{s.items.length}</small>
              </h3>
              <div className="storage-list">
                {s.items.map((item) => {
                  const Glyph = iconFor(item);
                  return (
                    <article key={item.id} className="storage-row">
                      <span className="storage-art" aria-hidden="true">
                        {item.category === "food" ? <FoodArt food={item.food} size={34} /> : <Glyph />}
                      </span>
                      <span className="storage-copy">
                        <strong>{item.name}</strong>
                        <small>
                          {detailFor(item)}
                          {item.currency ? " · bound to your account" : ""}
                        </small>
                      </span>
                      <b className="storage-count">×{owned(item)}</b>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}

        {reclaimable > 0 && (
          <div className="storage-reclaim">
            <span>
              {reclaimable} empty slot{reclaimable === 1 ? "" : "s"} still hold a deposit of about {((reclaimable * ACCOUNT_RENT_LAMPORTS) / 1e9).toFixed(4)} SOL.
            </span>
            <button className="ui-btn ui-btn-secondary store-buy" disabled={busy || !anchorWallet} onClick={reclaim}>
              {busy ? "Working…" : "Take it back"}
            </button>
          </div>
        )}
        {note && <p className="store-message ok">{note}</p>}
      </section>
    </div>
  );
}
