import {
  Connection,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import type { Wallet } from "@anchor-lang/core";
export type Progress = (message: string) => void;
export async function sendInstruction(
  connection: Connection,
  wallet: Wallet,
  ix: TransactionInstruction,
  progress: Progress = () => {},
) {
  if (
    (await connection.getGenesisHash()) !==
    "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
  ) {
    throw new Error(
      "This admin prototype only sends transactions to Solana devnet",
    );
  }
  const block = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ ...block, feePayer: wallet.publicKey }).add(ix);
  progress("Awaiting wallet signature...");
  const signed = await wallet.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  progress(`Transaction sent: ${signature}`);
  const result = await connection.confirmTransaction(
    { ...block, signature },
    "confirmed",
  );
  if (result.value.err)
    throw new Error(
      `Transaction ${signature} failed: ${JSON.stringify(result.value.err)}`,
    );
  progress("Confirmed");
  return signature;
}
