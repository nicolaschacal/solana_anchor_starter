import {
  Activity, Beef, Check, Cherry, Coins, Dna, Dumbbell, Fish, Flame, Flower2, Heart, Lamp, Leaf, Lock, Mountain,
  Shield, Snowflake, Sparkles, Sun, TreeDeciduous, TreePine, Trees, Droplets, X, Zap,
} from "lucide-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useState, type ComponentType } from "react";
import { buyFood, buyGems, expandIsland, buyItem } from "../../lib/economy/actions";
import { DEPLOYMENT } from "../../lib/economy/deployment";
import { useRebytersAuth } from "../../lib/rebyters/auth";
import { islandCapacity } from "../world/terrain";
import { FoodArt } from "./FoodArt";
import { CLIMATES, STORE_CATEGORIES, itemIdOf, itemsIn, type Climate, type StoreItem, type StoreTab } from "../../lib/economy/catalog";
import type { Inventory } from "../../lib/economy/inventory";
import { GEMS, formatGems, type GemBalance } from "../../lib/economy/token";

type Icon = ComponentType<{ "aria-hidden"?: boolean }>;

const CLIMATE_ICON: Record<Climate, Icon> = { temperate: Trees, arid: Sun, cold: Snowflake, humid: Droplets, volcanic: Flame };
const FOOD_ICON: Icon[] = [Beef, Leaf, Fish, Cherry];
const MACHINE_ICON: Icon[] = [Zap, Heart, Shield, Sparkles, Dna, Activity];
const DECOR_ICON: Record<string, Icon> = { tree: TreeDeciduous, hero: TreeDeciduous, pine: TreePine, lantern: Lamp, wildflowers: Flower2 };

export function iconFor(item: StoreItem): Icon {
  switch (item.category) {
    case "habitat":
      return CLIMATE_ICON[item.climate];
    case "food":
      return FOOD_ICON[item.food];
    case "machine":
      return MACHINE_ICON[item.training] ?? Dumbbell;
    case "evolution":
      return Dna;
    default:
      return DECOR_ICON[item.prop] ?? Mountain;
  }
}

export function detailFor(item: StoreItem) {
  switch (item.category) {
    case "habitat": {
      const spec = islandCapacity(item.size, item.climate);
      return `${item.size}×${item.size} · ${CLIMATES[item.climate].label} · ${spec.maxPlaced} rebyters · ${spec.maxProps} objects`;
    }
    case "food":
      return "Used up when fed";
    case "machine":
      return item.bonus;
    case "evolution":
      return `${item.stageLabel} form · used up on evolving`;
    default:
      return "Place it anywhere in your habitat";
  }
}

type Props = {
  balance: GemBalance;
  inventory: Inventory;
  onClose: () => void;
};

/**
 * The store. Prices are in Gems; until the gem mint is configured every purchase stays closed and the
 * sheet says so. Ownership comes from the wallet (see useInventory), never from the game.
 */
export function StoreSheet({ balance, inventory, onClose }: Props) {
  const [tab, setTab] = useState<StoreTab>("habitat");
  const items = itemsIn(tab);
  const { connection } = useConnection();
  const anchorWallet = useRebytersAuth().anchorWallet;
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (key: string, okText: string, job: () => Promise<unknown>) => {
    if (!anchorWallet) {
      setMessage({ ok: false, text: "Connect your wallet first" });
      return;
    }
    setBusy(key);
    setMessage(null);
    try {
      await job();
      setMessage({ ok: true, text: okText });
    } catch (e) {
      const text = e instanceof Error ? e.message : "Something went wrong";
      setMessage({ ok: false, text: /insufficient lamports|InsufficientGems|Not enough Gems/i.test(text) ? "Not enough SOL or Gems" : text.slice(0, 140) });
    } finally {
      setBusy("");
    }
  };

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
              {balance.loading ? "…" : formatGems(balance.amount)} <em>{GEMS.symbol}</em>
            </strong>
          </span>
          {!balance.launched && <span className="store-soon">Gem purchases are not open yet</span>}
        </div>

        {balance.launched && DEPLOYMENT.packs.length > 0 && (
          <div className="gem-packs" aria-label="Get Gems with SOL">
            {DEPLOYMENT.packs.map((pack) => (
              <button
                key={pack.id}
                className="gem-pack"
                disabled={!!busy}
                onClick={() => run(`pack${pack.id}`, `+${formatGems(pack.gems)} Gems added`, () => buyGems(connection, anchorWallet!, pack.id))}
              >
                <Coins aria-hidden="true" />
                <strong>{formatGems(pack.gems)}</strong>
                <small>{busy === `pack${pack.id}` ? "Buying…" : `${pack.priceLamports / 1e9} SOL`}</small>
              </button>
            ))}
          </div>
        )}
        {message && (
          <p className={`store-message ${message.ok ? "ok" : "bad"}`} role="status">
            {message.text}
          </p>
        )}

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
            const isIsland = item.category === "habitat";
            const starter = !isIsland && (owned === Number.POSITIVE_INFINITY || item.price === 0);
            // Islands grow one level at a time: what you already have, the next size, and what comes after.
            const islandOwned = isIsland && owned > 0;
            const islandLater = isIsland && !islandOwned && item.size > inventory.island.size + 2;
            const forSale = item.category === "food" ? DEPLOYMENT.food.prices.length > 0 : item.category === "habitat" ? itemIdOf(item) !== null : !!item.mint;
            const affordable = balance.amount >= item.price;
            const state = starter ? "starter" : islandOwned ? "owned" : islandLater ? "later" : !balance.launched || !forSale ? "soon" : affordable ? "buy" : "short";
            return (
              <article key={item.id} className={`store-card cat-${item.category}${item.category === "habitat" ? ` climate-${item.climate}` : ""}`}>
                <div className="store-card-art" aria-hidden="true">
                  {item.category === "food" ? <FoodArt food={item.food} /> : <Glyph />}
                  {owned > 0 && !starter && <b className="store-owned">×{owned}</b>}
                </div>
                <div className="store-card-copy">
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                  <em>{detailFor(item)}</em>
                </div>
                <div className="store-card-foot">
                  {starter || islandOwned ? (
                    <span className="store-price free">
                      <Check aria-hidden="true" /> {islandOwned ? "Your island" : "Included"}
                    </span>
                  ) : (
                    <span className="store-price">
                      <Coins aria-hidden="true" /> {formatGems(item.price)}
                    </span>
                  )}
                  {state !== "starter" && state !== "owned" && (
                    <button
                      className="ui-btn ui-btn-primary store-buy"
                      disabled={state !== "buy" || !!busy}
                      title={state === "soon" ? "Coming soon" : state === "later" ? "Get the smaller expansion first" : undefined}
                      onClick={() =>
                        run(item.id, item.category === "food" ? `${item.name} added to your food` : isIsland ? `Your island is now ${item.size}×${item.size}` : `${item.name} added to your wallet`, () =>
                          item.category === "food"
                            ? buyFood(connection, anchorWallet!, item.food, item.tier)
                            : item.category === "habitat"
                              ? expandIsland(connection, anchorWallet!, item.id)
                              : buyItem(connection, anchorWallet!, itemIdOf(item)!, item.mint!),
                        )
                      }
                    >
                      {busy === item.id ? (
                        "Buying…"
                      ) : state === "soon" ? (
                        <>
                          <Lock aria-hidden="true" /> Soon
                        </>
                      ) : state === "later" ? (
                        <>
                          <Lock aria-hidden="true" /> Next first
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

/** The Gems chip on the world HUD: tap it to open the store. */
export function BalanceChip({ balance, onOpen }: { balance: GemBalance; onOpen: () => void }) {
  const label = balance.loading ? "…" : formatGems(balance.amount);
  return (
    <button className="rbtyr-chip gl-panel" onClick={onOpen} aria-label={`${label} ${GEMS.symbol}. Open the store`}>
      <span className="store-coin" aria-hidden="true">
        <Coins />
      </span>
      <strong>{label}</strong>
    </button>
  );
}
