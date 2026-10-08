import {
  Activity, Beef, Check, Cherry, Coins, Dna, Dumbbell, Fish, Flame, Flower2, Heart, Lamp, Leaf, Lock, Mountain,
  Shield, Snowflake, Sparkles, Sun, TreeDeciduous, TreePine, Trees, Droplets, X, Zap,
} from "lucide-react";
import { useState, type ComponentType } from "react";
import { CLIMATES, STORE_CATEGORIES, itemsIn, type Climate, type StoreCategory, type StoreItem } from "../../lib/economy/catalog";
import type { Inventory } from "../../lib/economy/inventory";
import { RBTYR, formatRbtyr, type RbtyrBalance } from "../../lib/economy/token";

type Icon = ComponentType<{ "aria-hidden"?: boolean }>;

const CLIMATE_ICON: Record<Climate, Icon> = { temperate: Trees, arid: Sun, cold: Snowflake, humid: Droplets, volcanic: Flame };
const FOOD_ICON: Icon[] = [Beef, Leaf, Fish, Cherry];
const MACHINE_ICON: Icon[] = [Zap, Heart, Shield, Sparkles, Dna, Activity];
const DECOR_ICON: Record<string, Icon> = { tree: TreeDeciduous, hero: TreeDeciduous, pine: TreePine, lantern: Lamp, wildflowers: Flower2 };

function iconFor(item: StoreItem): Icon {
  switch (item.category) {
    case "habitat":
      return CLIMATE_ICON[item.climate];
    case "food":
      return FOOD_ICON[item.food];
    case "machine":
      return MACHINE_ICON[item.training] ?? Dumbbell;
    default:
      return DECOR_ICON[item.prop] ?? Mountain;
  }
}

function detailFor(item: StoreItem) {
  switch (item.category) {
    case "habitat":
      return `${item.size}×${item.size} · ${CLIMATES[item.climate].label} · ${item.slots} rebyters`;
    case "food":
      return `${item.pack} meals · used up when fed`;
    case "machine":
      return item.bonus;
    default:
      return "Place it anywhere in your habitat";
  }
}

type Props = {
  balance: RbtyrBalance;
  inventory: Inventory;
  onClose: () => void;
};

/**
 * The store. Prices are in $RBTYR; until the token exists every purchase stays closed and the
 * sheet says so. Ownership comes from the wallet (see useInventory), never from the game.
 */
export function StoreSheet({ balance, inventory, onClose }: Props) {
  const [tab, setTab] = useState<StoreCategory>("habitat");
  const items = itemsIn(tab);

  return (
    <div className="game-sheet-backdrop" onClick={onClose}>
      <section className="game-sheet store-sheet" role="dialog" aria-modal="true" aria-label="Store" onClick={(e) => e.stopPropagation()}>
        <div className="game-sheet-head">
          <div>
            <small>STORE</small>
            <h2>Rebyters Store</h2>
          </div>
          <button className="ui-close" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </div>

        <div className="store-balance" role="status">
          <span className="store-coin" aria-hidden="true">
            <Coins />
          </span>
          <span className="store-balance-copy">
            <small>Your balance</small>
            <strong>
              {balance.loading ? "…" : formatRbtyr(balance.amount)} <em>${RBTYR.symbol}</em>
            </strong>
          </span>
          {!balance.launched && <span className="store-soon">Purchases open when ${RBTYR.symbol} launches</span>}
        </div>

        <div className="store-tabs" role="tablist" aria-label="Store sections">
          {STORE_CATEGORIES.map((c) => (
            <button key={c.id} role="tab" aria-selected={tab === c.id} className={tab === c.id ? "active" : ""} onClick={() => setTab(c.id)}>
              {c.label}
            </button>
          ))}
        </div>

        <div className="store-grid" role="tabpanel">
          {items.map((item) => {
            const Glyph = iconFor(item);
            const owned = inventory.count(item);
            const starter = owned === Number.POSITIVE_INFINITY;
            const affordable = balance.amount >= item.price;
            const state = starter ? "starter" : !balance.launched || !item.mint ? "soon" : affordable ? "buy" : "short";
            return (
              <article key={item.id} className={`store-card cat-${item.category}${item.category === "habitat" ? ` climate-${item.climate}` : ""}`}>
                <div className="store-card-art" aria-hidden="true">
                  <Glyph />
                  {owned > 0 && !starter && <b className="store-owned">×{owned}</b>}
                </div>
                <div className="store-card-copy">
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                  <em>{detailFor(item)}</em>
                </div>
                <div className="store-card-foot">
                  {starter ? (
                    <span className="store-price free">
                      <Check aria-hidden="true" /> Included
                    </span>
                  ) : (
                    <span className="store-price">
                      <Coins aria-hidden="true" /> {formatRbtyr(item.price)}
                    </span>
                  )}
                  {state !== "starter" && (
                    <button className="ui-btn ui-btn-primary store-buy" disabled title={state === "soon" ? "Coming soon" : undefined}>
                      {state === "soon" ? (
                        <>
                          <Lock aria-hidden="true" /> Soon
                        </>
                      ) : state === "short" ? (
                        "Not enough"
                      ) : (
                        "Buy"
                      )}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** The $RBTYR chip on the world HUD: tap it to open the store. */
export function BalanceChip({ balance, onOpen }: { balance: RbtyrBalance; onOpen: () => void }) {
  const label = balance.loading ? "…" : formatRbtyr(balance.amount);
  return (
    <button className="rbtyr-chip gl-panel" onClick={onOpen} aria-label={`${label} ${RBTYR.symbol}. Open the store`}>
      <span className="store-coin" aria-hidden="true">
        <Coins />
      </span>
      <strong>{label}</strong>
    </button>
  );
}
