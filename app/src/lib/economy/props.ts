import type { AssetKey } from "../../components/assets/meadow";
import { CATALOG } from "./catalog";
import type { Inventory } from "./inventory";

/**
 * How many objects of one kind a player may have placed. Free (starter) objects and the engine's own
 * props that are not sold are unlimited; sold decor is limited to what the wallet holds, whether it
 * was bought with Gems or with Sparks.
 */
export function propAllowance(inventory: Inventory, key: AssetKey): number {
  const sold = CATALOG.filter((item) => item.category === "decor" && item.prop === key);
  if (!sold.length || sold.some((item) => item.starter)) return Number.POSITIVE_INFINITY;
  return sold.reduce((sum, item) => sum + inventory.count(item), 0);
}
