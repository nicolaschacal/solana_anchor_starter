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
  buildMammalWorkbookUpgrade,
  containsMammalWorkbook,
  sampleMammal,
} from "../src/lib/rebyters/sample";
import { fetchVerifiedTree } from "../src/lib/rebyters/tree";
import { PROGRAM_ID, registryPda, treePda } from "../src/lib/rebyters/config";
import { canonicalTree } from "../src/lib/rebyters/canonical";

const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const walletPath =
  process.env.SOLANA_WALLET_PATH || "../artifacts/private/admin-keypair.json";
const irysPath = process.env.IRYS_WALLET_PATH || walletPath;
const journalFile = "../artifacts/publication/mammal-chart-v2-pending.json";

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
  const signer = await keypair(walletPath);
  const wallet = new Wallet(signer);
  const connection = new Connection(rpc, "confirmed");
  const genesis = await connection.getGenesisHash();
  if (genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") {
    throw new Error("This publishing command is restricted to Solana devnet");
  }

  const deployed = await connection.getAccountInfo(PROGRAM_ID);
  if (!deployed?.executable) {
    throw new Error("The Rebyters registry program is not deployed on devnet");
  }

  const writer = new RegistryWriter(connection, wallet, (instruction) =>
    sendInstruction(connection, wallet, instruction, console.log),
  );
  const registry = await fetchRegistry(connection);
  if (!registry || registry.authority !== signer.publicKey.toBase58()) {
    throw new Error("Configured wallet is not the registry authority");
  }
  if (!registry.activeVersions[0]) {
    throw new Error(
      "Mammal has no active version; use the initial sample publisher first",
    );
  }

  const activeMeta = await fetchTree(connection, 0, registry.activeVersions[0]);
  if (!activeMeta) throw new Error("Active Mammal metadata is missing");
  const previous = await fetchVerifiedTree(activeMeta);
  if (containsMammalWorkbook(previous)) {
    console.log(
      JSON.stringify(
        {
          status: "Active Mammal already contains the workbook",
          version: registry.activeVersions[0],
          evolutions: previous.evolutions.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  await mkdir("../artifacts/publication", { recursive: true });
  let journal: PublishJournal | undefined;
  try {
    journal = JSON.parse(await readFile(journalFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (journal) {
    if (journal.baseVersion !== registry.activeVersions[0]) {
      throw new Error("Pending workbook publication has a stale base version");
    }
  } else {
    const seed = sampleMammal();
    console.log(`Reserving ${seed.evolutions.length} workbook evolution IDs`);
    const start = await writer.reserve(seed.evolutions.length);
    journal = {
      tree: buildMammalWorkbookUpgrade(
        start,
        registry.nextVersions[0],
        previous,
      ),
      baseVersion: registry.activeVersions[0],
      replaceCollection: true,
    };
    await writeFile(journalFile, JSON.stringify(journal, null, 2));
  }

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
        console.log("Funding Irys devnet upload balance");
        await irys.fund(price.minus(balance));
      }
      return irys;
    },
    save,
    console.log,
    process.env.IRYS_GATEWAY || "https://gateway.irys.xyz",
  );

  const meta = await fetchTree(connection, 0, tree.version);
  await writeFile(
    "../artifacts/publication/mammal-chart-v2.json",
    canonicalTree(tree),
  );
  const report = {
    status: "Workbook published and verified on devnet",
    programId: PROGRAM_ID.toBase58(),
    registryPda: registryPda().toBase58(),
    treePda: treePda(0, tree.version).toBase58(),
    creatures: tree.evolutions.length,
    connections: tree.evolutions.reduce((sum, e) => sum + e.paths.length, 0),
    ...meta,
  };
  await writeFile(
    "../artifacts/publication/mammal-chart-v2-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Publication failed");
  process.exitCode = 1;
});
