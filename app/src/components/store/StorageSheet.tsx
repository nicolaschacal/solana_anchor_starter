import { Coins, PackageOpen, X } from "lucide-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useState } from "react";
import { ACCOUNT_RENT_LAMPORTS, reclaimRent } from "../../lib/economy/actions";
import { CATALOG, STORE_CATEGORIES, type StoreItem } from "../../lib/economy/catalog";
import type { Inventory } from "../../lib/economy/inventory";
import { GEMS, formatGems, type GemBalance } from "../../lib/economy/token";
import { useRebytersAuth } from "../../lib/rebyters/auth";
import { FoodArt } from "./FoodArt";
import { detailFor, iconFor } from "./StoreSheet";


/** Everything the wallet holds, grouped by type. Read from the wallet; nothing is stored by the game. */
export function StorageSheet({ balance, inventory, onClose, embedded = false }: { balance: GemBalance; inventory: Inventory; onClose: () => void; embedded?: boolean }) {
  const { connection } = useConnection();
  const anchorWallet = useRebytersAuth().anchorWallet;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const owned = (item: StoreItem) => {
    const n = inventory.count(item);
    return n === Number.POSITIVE_INFINITY ? 0 : n;
  };
  // Habitats live in Decorate → Islands; the bag holds what you carry: food, machines, items, decor.
  const items = STORE_CATEGORIES.filter((c) => c.id !== "habitat")
    .flatMap((c) => CATALOG.filter((item) => item.category === c.id && owned(item) > 0).sort((a, b) => a.name.localeCompare(b.name)));
  const [picked, setPicked] = useState<string | null>(null);
  const selected = items.find((item) => item.id === picked) ?? null;
  const slots = Math.max(16, Math.ceil(items.length / 4) * 4 + (items.length % 4 === 0 ? 4 : 0));
  const total = items.length;
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

  const Wrap = ({ children }: { children: React.ReactNode }) =>
    embedded ? (
      <section className="storage-sheet storage-embedded" aria-label="Bag">{children}</section>
    ) : (
      <div className="game-sheet-backdrop" onClick={onClose}>
        <section className="game-sheet store-sheet storage-sheet" role="dialog" aria-modal="true" aria-label="Bag" onClick={(e) => e.stopPropagation()}>{children}</section>
      </div>
    );

  return (
    <Wrap>
        <div className="game-sheet-head">
          <div>
            <small>YOUR WALLET</small>
            <h2>Bag</h2>
          </div>
          {!embedded && (
            <button className="ui-close" aria-label="Close" onClick={onClose}>
              <X />
            </button>
          )}
        </div>

        <div className="storage-currencies">
          <span>
            <Coins aria-hidden="true" /> {balance.loading ? "…" : formatGems(balance.amount)} {GEMS.symbol}
          </span>
        </div>

        {total === 0 && (
          <p className="storage-empty">
            <PackageOpen aria-hidden="true" /> Nothing here yet. Claim your daily ration or visit the store.
          </p>
        )}

        <div className="bag-grid" role="list">
          {Array.from({ length: slots }, (_, i) => {
            const item = items[i];
            if (!item) return <span key={`empty-${i}`} className="bag-slot empty" role="listitem" aria-hidden="true" />;
            const Glyph = iconFor(item);
            return (
              <button key={item.id} role="listitem" className="bag-slot" data-on={picked === item.id} aria-label={`${item.name}, ${owned(item)}`} onClick={() => setPicked(picked === item.id ? null : item.id)}>
                <span className="bag-art" aria-hidden="true">{item.category === "food" ? <FoodArt food={item.food} size={36} /> : <Glyph />}</span>
                <span className="bag-name">{item.name}</span>
                <b className="bag-count">×{owned(item)}</b>
              </button>
            );
          })}
        </div>
        {selected && (
          <div className="bag-detail" role="status">
            <strong>{selected.name}</strong>
            <small>{detailFor(selected)}</small>
          </div>
        )}

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
    </Wrap>
  );
}
