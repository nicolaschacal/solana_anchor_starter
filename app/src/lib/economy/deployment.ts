import raw from "./deployment.json";

/** Addresses created by `npm run setup:economy` (devnet). Public information, committed on purpose. */
export type EconomyDeployment = {
  cluster: "devnet";
  programId: string;
  economy: string;
  treasury: string;
  gemMint: string | null;
  sparkMint: string | null;
  /** meat, plants, fish, fruit */
  foodMints: string[];
  rationUnits: number;
  packs: { id: number; gems: number; priceLamports: number }[];
  items: Record<string, { itemId: number; mint: string }>;
};

export const DEPLOYMENT = raw as EconomyDeployment;
