import raw from "./deployment.json";

/** Addresses created by `npm run setup:economy` (devnet). Public information, committed on purpose. */
export type EconomyDeployment = {
  cluster: "devnet";
  programId: string;
  economy: string;
  treasury: string;
  gemMint: string | null;
  /** Gem price of one meal, index food * 4 + tier (meat, plants, fish, fruit; plain to feast). Empty = not set up. */
  food: { prices: number[] };
  /** Meals of each food in the free daily ration; 0 = off. */
  rationUnits: number;
  packs: { id: number; gems: number; priceLamports: number }[];
  /** Store items registered on-chain. Habitats have no shared mint: every habitat is its own NFT. */
  items: Record<string, { itemId: number; mint: string | null; /** Evolution items: the evolution id they create. */ evoTarget?: number }>;
};

export const DEPLOYMENT = raw as EconomyDeployment;
