import { foodThumbUrl } from "../../lib/economy/foodAssets";

/** The picture of a meal (a render of its 3D model). index: meat, plants, fish, fruit; tier 0-3. */
export function FoodArt({ food, tier = 0, size = 56 }: { food: number; tier?: number; size?: number }) {
  return <img className="food-art" src={foodThumbUrl(food, tier)} width={size} height={size} alt="" aria-hidden="true" loading="lazy" draggable={false} />;
}
