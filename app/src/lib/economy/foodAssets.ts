/** The 3D model and the thumbnail of each meal (food 0-3: meat, plants, fish, fruit; tier 0-3). */
export const foodModelUrl = (food: number, tier: number) => `/assets/food/${FOOD_KEYS[food]}-${tier}.glb`;
export const foodThumbUrl = (food: number, tier: number) => `/assets/food/thumbs/${FOOD_KEYS[food]}-${tier}.png`;
const FOOD_KEYS = ["meat", "plants", "fish", "fruit"];
