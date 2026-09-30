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
  return {
    async upload(
      data: string,
      options: { tags: { name: string; value: string }[] },
    ) {
      const price = await irys.getPrice(new TextEncoder().encode(data).length);
      const balance = await irys.getLoadedBalance();
      if (balance.lt(price)) await irys.fund(price.minus(balance));
      return irys.upload(data, options);
    },
  };
}
