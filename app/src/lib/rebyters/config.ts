import { PublicKey } from "@solana/web3.js";
export const PROGRAM_ID = new PublicKey(
  "7AnfhSTGK11PUqep6wdfkCcSuwhAsaU4RwYfDGdcWyfp",
);
export const RPC_URL =
  import.meta.env?.VITE_SOLANA_RPC_URL || "https://api.devnet.solana.com";
export const IRYS_GATEWAY =
  import.meta.env?.VITE_IRYS_GATEWAY || "https://gateway.irys.xyz";
export const registryPda = () =>
  PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("registry")],
    PROGRAM_ID,
  )[0];
export function treePda(family: number, version: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, version, true);
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("tree"), Uint8Array.of(family), bytes],
    PROGRAM_ID,
  )[0];
}

export function ruleSetPda(family: number, version: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, version, true);
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("rules"), Uint8Array.of(family), bytes],
    PROGRAM_ID,
  )[0];
}

export function playerProfilePda(owner: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("profile3"), owner.toBytes()],
    PROGRAM_ID,
  )[0];
}

/** The authority PDA that writes a habitat NFT's layout (it only signs inside the program). */
export function habitatAuthorityPda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("habitat_authority"), mint.toBytes()],
    PROGRAM_ID,
  )[0];
}
