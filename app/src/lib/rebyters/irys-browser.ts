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
  // Pin the browser uploader to Irys' Solana devnet node explicitly.
  // Relying on the SDK's generic .devnet() shortcut has proven inconsistent
  // for browser funding, while this is the endpoint used by the established
  // Solana/Irys integrations.
  const irys = await WebUploader(WebSolana)
    .withProvider(wallet)
    .withRpc(RPC_URL)
    .bundlerUrl("https://devnet.irys.xyz")
    .build();
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function ensureUploadBalance(byteLength: number) {
    const price = await irys.getPrice(byteLength);
    let balance = await irys.getLoadedBalance();
    // Keep headroom above the quoted payload price. The upload transaction has
    // its own header/signature overhead, so equality is not sufficient.
    // Avoid relying on BigNumber methods that are not consistently exposed by
    // every browser build of the Irys SDK. A fixed 20k-lamport headroom is
    // enough for this devnet uploader and preserves the SDK's own number type.
    const uploadTarget = price.plus(20_000);
    if (balance.gte(uploadTarget)) return;

    // Irys devnet has an intermittent accounting issue for tiny deposits.
    // Keep a fixed 20,000-lamport floor: this is still devnet SOL, but is large
    // enough to avoid the tiny-deposit behaviour documented by Irys SDK users.
    const DEVNET_FLOOR_LAMPORTS = 20_000;
    const floor = price.minus(price).plus(DEVNET_FLOOR_LAMPORTS);
    const target = floor.gt(uploadTarget) ? floor : uploadTarget;
    const missing = target.minus(balance);
    if (missing.gt(0)) await irys.fund(missing);

    for (let attempt = 0; attempt < 30; attempt++) {
      await sleep(1000);
      balance = await irys.getLoadedBalance();
      if (balance.gte(uploadTarget)) return;
    }
    throw new Error(
      `Irys devnet funding was signed but not credited after 30s (price=${price.toString()}, loaded=${balance.toString()}).`,
    );
  }

  return {
    async upload(
      data: string | Uint8Array,
      options: { tags: { name: string; value: string }[] },
    ) {
      const bytes = typeof data === "string" ? new TextEncoder().encode(data).length : data.byteLength;
      await ensureUploadBalance(bytes);

      // Do not ask the wallet to sign repeatedly. A successful funding signature
      // is followed by one upload attempt; if Irys still rejects it, surface
      // diagnostics instead of charging/funding again blindly.
      try {
        return await irys.upload(data as any, options);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("402") && !message.toLowerCase().includes("not enough balance")) throw error;
        const price = await irys.getPrice(bytes);
        const balance = await irys.getLoadedBalance();
        throw new Error(
          `Irys devnet rejected the upload after funding (402). payloadPrice=${price.toString()} loadedBalance=${balance.toString()} wallet=${wallet.publicKey!.toBase58()}`,
        );
      }
    },
  };
}
