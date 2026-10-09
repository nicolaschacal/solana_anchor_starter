import raw from "./deployment.json";

/** Addresses created by `npm run setup:economy` (devnet). Public information, committed on purpose. */
export type EconomyDeployment = {
  cluster: "devnet";
  programId: string;
  economy: string;
  treasury: string;
  gemMint: string | null;
  /** Meals in a purchased pack, and the Gem price of one pack of meat, plants, fish, fruit. 0 = not set up. */
  food: { packMeals: number; prices: number[] };
  /** Meals of each food in the free daily ration; 0 = off. */
  rationUnits: number;
  packs: { id: number; gems: number; priceLamports: number }[];
  /** Store items registered on-chain. Habitats have no shared mint: every habitat is its own NFT. */
  items: Record<string, { itemId: number; mint: string | null }>;
};

export const DEPLOYMENT = raw as EconomyDeployment;
