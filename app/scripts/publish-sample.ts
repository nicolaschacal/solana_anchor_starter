import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Connection, Keypair } from "@solana/web3.js";
import { Wallet } from "@anchor-lang/core";
import { Uploader } from "@irys/upload";
import { Solana } from "@irys/upload-solana";
import {
  RegistryWriter,
  fetchRegistry,
  fetchTree,
} from "../src/lib/rebyters/registry";
import { sendInstruction } from "../src/lib/rebyters/transactions";
import { publishTree, type PublishJournal } from "../src/lib/rebyters/publish";
import {
  MAMMAL_SEED_EVOLUTION_COUNT,
  sampleMammal,
} from "../src/lib/rebyters/sample";
import { fetchVerifiedTree } from "../src/lib/rebyters/tree";
import { PROGRAM_ID, registryPda, treePda } from "../src/lib/rebyters/config";
import { canonicalTree } from "../src/lib/rebyters/canonical";

const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const walletPath =
  process.env.SOLANA_WALLET_PATH || "../artifacts/private/admin-keypair.json";
const irysPath = process.env.IRYS_WALLET_PATH || walletPath;
async function keypair(path: string) {
  try {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(await readFile(path, "utf8"))),
    );
  } catch {
    throw new Error(
      `Wallet unavailable at ${path}; set SOLANA_WALLET_PATH / IRYS_WALLET_PATH. No key material is logged.`,
    );
  }
}
async function main() {
  const signer = await keypair(walletPath),
    wallet = new Wallet(signer),
    connection = new Connection(rpc, "confirmed");
  const genesis = await connection.getGenesisHash();
  if (genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG")
    throw new Error("This prototype publishing script requires Solana devnet");
  const deployed = await connection.getAccountInfo(PROGRAM_ID);
  if (!deployed?.executable)
    throw new Error(
      "Program is not deployed. Run anchor build and anchor deploy --provider.cluster devnet first.",
    );
  const writer = new RegistryWriter(connection, wallet, (ix) =>
    sendInstruction(connection, wallet, ix, console.log),
  );
  let registry = await fetchRegistry(connection);
  if (!registry) {
    console.log("Initializing registry using upgrade authority");
    await writer.initialize();
    registry = await fetchRegistry(connection);
  }
  if (!registry || registry.authority !== signer.publicKey.toBase58())
    throw new Error("Configured wallet is not registry authority");
  await mkdir("../artifacts/publication", { recursive: true });
  const journalFile = "../artifacts/publication/mammal-pending.json";
  let journal: PublishJournal;
  try {
    journal = JSON.parse(await readFile(journalFile, "utf8"));
  } catch {
    if (registry.activeVersions[0]) {
      const meta = await fetchTree(connection, 0, registry.activeVersions[0]);
      if (!meta) throw new Error("Active metadata missing");
      await fetchVerifiedTree(meta);
      console.log(
        JSON.stringify(
          { status: "Existing active Mammal verified", ...meta },
          null,
          2,
        ),
      );
      return;
    }
    console.log(`Reserving ${MAMMAL_SEED_EVOLUTION_COUNT} evolution IDs`);
    const start = await writer.reserve(MAMMAL_SEED_EVOLUTION_COUNT);
    journal = {
      tree: sampleMammal(start, registry.nextVersions[0]),
      baseVersion: 0,
    };
    await writeFile(journalFile, JSON.stringify(journal, null, 2));
  }
  // Persist receipts before continuing to Solana so interrupted uploads can be reused.
  const save = async (value: PublishJournal) => {
    await writeFile(journalFile, JSON.stringify(value, null, 2));
  };
  const tree = await publishTree(
    writer,
    journal,
    async () => {
      const irysSigner = await keypair(irysPath);
      const irys = await Uploader(Solana)
        .withWallet(irysSigner.secretKey)
        .withRpc(rpc)
        .devnet();
      const price = await irys.getPrice(
        new TextEncoder().encode(canonicalTree(journal.tree)).length,
      );
      const balance = await irys.getLoadedBalance();
      if (balance.lt(price)) {
        console.log("Funding Irys upload balance with required devnet SOL");
        await irys.fund(price.minus(balance));
      }
      return irys;
    },
    save,
    console.log,
    process.env.IRYS_GATEWAY || "https://gateway.irys.xyz",
  );
  const meta = await fetchTree(connection, 0, tree.version);
  await writeFile("../artifacts/publication/mammal.json", canonicalTree(tree));
  const report = {
    status: "Published and verified on devnet",
    programId: PROGRAM_ID.toBase58(),
    registryPda: registryPda().toBase58(),
    treePda: treePda(0, tree.version).toBase58(),
    ...meta,
  };
  await writeFile(
    "../artifacts/publication/report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Publication failed");
  process.exitCode = 1;
});
