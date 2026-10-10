/**
 * Uploads a GLB model to Irys (devnet) and records its permanent URI in
 * src/lib/rebyters/model-uris.json, keyed by model name.
 *
 *   MODEL_FILE=scripts/assets/models/finbit.glb npm run publish:model
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { Keypair } from "@solana/web3.js";
import { Uploader } from "@irys/upload";
import { Solana } from "@irys/upload-solana";

const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const walletPath = process.env.IRYS_WALLET_PATH || process.env.SOLANA_WALLET_PATH || "../artifacts/private/admin-keypair.json";
const file = process.env.MODEL_FILE || "scripts/assets/models/finbit.glb";
const gateway = process.env.IRYS_GATEWAY || "https://gateway.irys.xyz";
const registryFile = "src/lib/rebyters/model-uris.json";

async function main() {
  const data = await readFile(file);
  if (data.subarray(0, 4).toString("ascii") !== "glTF") throw new Error(`${file} is not a binary glTF (.glb)`);
  const name = basename(file).replace(/\.glb$/i, "");
  const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(walletPath, "utf8"))));
  const irys = await Uploader(Solana).withWallet(signer.secretKey).withRpc(rpc).devnet();
  const price = await irys.getPrice(data.length);
  const want = price.multipliedBy(2).integerValue();
  const balance = await irys.getLoadedBalance();
  console.log(`Irys price ${price.toString()}, loaded balance ${balance.toString()}`);
  if (balance.lt(want)) {
    console.log("Funding Irys upload balance with devnet SOL");
    await irys.fund(want.minus(balance));
    // The deposit is credited a little after the transaction confirms; wait for it before uploading.
    for (let n = 0; n < 30 && (await irys.getLoadedBalance()).lt(price); n++) await new Promise((r) => setTimeout(r, 5000));
    console.log(`Loaded balance now ${(await irys.getLoadedBalance()).toString()}`);
  }
  const receipt = await irys.upload(data, { tags: [{ name: "Content-Type", value: "model/gltf-binary" }, { name: "App", value: "reByters" }, { name: "Model", value: name }] });
  const uri = `${gateway}/${receipt.id}`;
  let registry: Record<string, { uri: string; bytes: number }> = {};
  try {
    registry = JSON.parse(await readFile(registryFile, "utf8"));
  } catch {}
  registry[name] = { uri, bytes: data.length };
  await writeFile(registryFile, JSON.stringify(registry, null, 2) + "\n");
  console.log(`MODEL ${name} ${uri}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
