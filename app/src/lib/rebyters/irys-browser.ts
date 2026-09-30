import { WebUploader } from "@irys/web-upload";
import { WebSolana } from "@irys/web-upload-solana";
import { Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { RPC_URL } from "./config";
export async function browserUploader(wallet: WalletContextState) {
  if (
    (await new Connection(RPC_URL).getGenesisHash()) !==
    "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
  ) {
    throw new Error("Irys prototype funding requires Solana devnet");
  }
  if (!wallet.publicKey || !wallet.signMessage)
    throw new Error("Connect a Solana wallet supporting message signing");
  const irys = await WebUploader(WebSolana)
    .withProvider(wallet)
    .withRpc(RPC_URL)
    .devnet();
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function ensureUploadBalance(byteLength: number) {
    const price = await irys.getPrice(byteLength);
    let balance = await irys.getLoadedBalance();
    if (balance.gte(price)) return;

    // Irys funding transactions have overhead/minimums that are larger than a
    // tiny JSON upload price. Funding only `price` can produce a transaction
    // that the devnet node rejects with HTTP 402 even when the wallet itself
    // has plenty of devnet SOL. Keep a small devnet upload buffer instead.
    const minimumBuffer = price.multipliedBy(20);
    const target = minimumBuffer.gt(price) ? minimumBuffer : price;
    await irys.fund(target);

    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(1000);
      balance = await irys.getLoadedBalance();
      if (balance.gte(price)) return;
    }
    throw new Error("Irys devnet funding was signed, but its loaded balance did not update. Retry Publish.");
  }

  return {
    async upload(
      data: string,
      options: { tags: { name: string; value: string }[] },
    ) {
      const bytes = new TextEncoder().encode(data).length;
      await ensureUploadBalance(bytes);

      // Irys devnet can briefly return 402 while a fresh deposit propagates.
      // Re-check/fund and retry instead of making the admin restart publication.
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await irys.upload(data, options);
        } catch (error) {
          lastError = error;
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes("402") && !message.toLowerCase().includes("not enough balance")) throw error;
          await ensureUploadBalance(bytes);
          await sleep(1200 * (attempt + 1));
        }
      }
      throw lastError;
    },
  };
}
