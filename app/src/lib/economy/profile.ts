import type { Connection, PublicKey } from "@solana/web3.js";
import { playerProfilePda } from "../rebyters/config";
import { getProgram } from "../rebyters/registry";

/** The part of the wallet's single PlayerProfile account the economy cares about. */
export type ProfileState = {
  rationDay: number;
  questDay: number;
  counts: number[];
  claimed: number;
  /** Meals in stock: meat, plants, fish, fruit. */
  food: number[];
  starterClaimed: boolean;
  /** Mint of the habitat NFT shown when the game opens, or null. */
  activeHabitat: string | null;
};

export async function fetchProfileState(connection: Connection, owner: PublicKey): Promise<ProfileState | null> {
  const account = await (getProgram(connection).account as any).playerProfile.fetchNullable(playerProfilePda(owner), "confirmed");
  if (!account) return null;
  const active = account.activeHabitat.toBase58();
  return {
    rationDay: Number(account.rationDay),
    questDay: Number(account.questDay),
    counts: Array.from(account.counts as number[]),
    claimed: Number(account.claimed),
    food: Array.from(account.food as number[]).map(Number),
    starterClaimed: !!account.starterClaimed,
    activeHabitat: active === "11111111111111111111111111111111" ? null : active,
  };
}
