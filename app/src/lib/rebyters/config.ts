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
