import type { Connection, PublicKey } from "@solana/web3.js";
import { playerProfilePda } from "../rebyters/config";
import { getProgram } from "../rebyters/registry";
import { layoutFromHex } from "../rebyters/habitat-layout";
import type { WorldLayout } from "../../components/world/layout";

/** The part of the wallet's single PlayerProfile account the economy cares about. */
export type ProfileState = {
  rationDay: number;
  questDay: number;
  counts: number[];
  claimed: number;
  /** Meals in stock, index food * 4 + tier (meat, plants, fish, fruit; plain to feast). */
  food: number[];
  starterClaimed: boolean;
  /** How far the island has grown: 0 = 5×5, 1 = 7×7, 2 = 9×9. */
  islandLevel: number;
  /** Where the reByters and objects stand, or null while the island was never laid out. */
  layout: WorldLayout | null;
};

export async function fetchProfileState(connection: Connection, owner: PublicKey): Promise<ProfileState | null> {
  const account = await (getProgram(connection).account as any).playerProfile.fetchNullable(playerProfilePda(owner), "confirmed");
  if (!account) return null;
  const hex = Array.from(account.layout as number[], (b) => Number(b).toString(16).padStart(2, "0")).join("");
  return {
    rationDay: Number(account.rationDay),
    questDay: Number(account.questDay),
    counts: Array.from(account.counts as number[]),
    claimed: Number(account.claimed),
    food: Array.from(account.food as number[]).map(Number),
    starterClaimed: !!account.starterClaimed,
    islandLevel: Number(account.islandLevel),
    layout: layoutFromHex(hex),
  };
}
