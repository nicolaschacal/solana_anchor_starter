import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Connection, Keypair } from "@solana/web3.js";
import { Wallet } from "@anchor-lang/core";
import { Uploader } from "@irys/upload";
import { Solana } from "@irys/upload-solana";
import { RegistryWriter, fetchRegistry, fetchTree } from "../src/lib/rebyters/registry";
import { sendInstruction } from "../src/lib/rebyters/transactions";
import { publishTree, type PublishJournal } from "../src/lib/rebyters/publish";
import { MAMMAL_SEED_EVOLUTION_COUNT, sampleMammal } from "../src/lib/rebyters/sample";
import { PROGRAM_ID, registryPda, treePda } from "../src/lib/rebyters/config";
import { canonicalTree, contentHash } from "../src/lib/rebyters/canonical";
import { validateTree } from "../src/lib/rebyters/validation";

const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const walletPath =
  process.env.SOLANA_WALLET_PATH || "../artifacts/private/admin-keypair.json";
const irysPath = process.env.IRYS_WALLET_PATH || walletPath;
const journalFile = "../artifacts/publication/mammal-dna-v3-pending.json";

async function keypair(path: string) {
  try {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(await readFile(path, "utf8"))),
    );
  } catch {
    throw new Error(
      `Wallet unavailable at ${path}; set SOLANA_WALLET_PATH / IRYS_WALLET_PATH.`,
    );
  }
}

async function main() {
  const signer = await keypair(walletPath);
  const wallet = new Wallet(signer);
  const connection = new Connection(rpc, "confirmed");

  const genesis = await connection.getGenesisHash();
  if (genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") {
    throw new Error("This DNA v3 publishing command is restricted to Solana devnet");
  }

  const deployed = await connection.getAccountInfo(PROGRAM_ID);
  if (!deployed?.executable) {
    throw new Error("Deploy the DNA v3 Rebyters program before publishing the atlas");
  }

  const writer = new RegistryWriter(connection, wallet, instruction =>
    sendInstruction(connection, wallet, instruction, console.log),
  );
  const registry = await fetchRegistry(connection);
  if (!registry || registry.authority !== signer.publicKey.toBase58()) {
    throw new Error("Configured wallet is not the registry authority");
  }

  const activeVersion = registry.activeVersions[0] ?? 0;

  await mkdir("../artifacts/publication", { recursive: true });

  // DNA v3 is a clean devnet generation. Do not preserve old evolution IDs,
  // old rules, or any compatibility layer. The only source of truth is the
  // canonical DNA v3 Mammal seed.
  let journal: PublishJournal | undefined;
  try {
    journal = JSON.parse(await readFile(journalFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const nextVersion = registry.nextVersions[0];

  // A pending journal is reusable only if it was created by this fresh DNA v3
  // flow for the current base/version and still validates against today's code.
  let reusePending = false;
  if (
    journal &&
    journal.baseVersion === activeVersion &&
    journal.tree.version === nextVersion &&
    journal.replaceCollection === true
  ) {
    try {
      validateTree(journal.tree);
      reusePending = journal.tree.proofMode === "unified-v1";
    } catch {
      reusePending = false;
    }
  }

  if (!reusePending) {
    console.log(
      `Reserving ${MAMMAL_SEED_EVOLUTION_COUNT} fresh DNA v3 evolution IDs`,
    );
    const start = await writer.reserve(MAMMAL_SEED_EVOLUTION_COUNT);
    const desiredTree = sampleMammal(start, nextVersion);
    validateTree(desiredTree);

    journal = {
      tree: desiredTree,
      baseVersion: activeVersion,
      replaceCollection: true,
    };
    await writeFile(journalFile, JSON.stringify(journal, null, 2));
  } else {
    console.log("Reusing fresh DNA v3 pending publication");
  }

  if (journal.tree.proofMode !== "unified-v1") {
    throw new Error("DNA v3 requires unified-v1 atlas proofs");
  }

  console.log(
    JSON.stringify(
      {
        status: "Preparing fresh DNA v3 atlas",
        fromVersion: activeVersion,
        toVersion: journal.tree.version,
        creatures: journal.tree.evolutions.length,
        connections: journal.tree.evolutions.reduce(
          (sum, evolution) => sum + evolution.paths.length,
          0,
        ),
        contentHash: contentHash(journal.tree),
      },
      null,
      2,
    ),
  );

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
        new TextEncoder().encode(canonicalTree(journal!.tree)).length,
      );
      const balance = await irys.getLoadedBalance();
      if (balance.lt(price)) {
        console.log("Funding Irys devnet upload balance");
        await irys.fund(price.minus(balance));
      }
      return {
        upload: (data: string | Uint8Array, options: { tags: { name: string; value: string }[] }) =>
          irys.upload(
            typeof data === "string" ? data : Buffer.from(data),
            options,
          ),
      };
    },
    save,
    console.log,
    process.env.IRYS_GATEWAY || "https://gateway.irys.xyz",
  );

  const meta = await fetchTree(connection, 0, tree.version);
  await writeFile(
    "../artifacts/publication/mammal-dna-v3.json",
    canonicalTree(tree),
  );

  const report = {
    status: "DNA v3 Mammal atlas published and activated on devnet",
    programId: PROGRAM_ID.toBase58(),
    registryPda: registryPda().toBase58(),
    treePda: treePda(0, tree.version).toBase58(),
    creatures: tree.evolutions.length,
    connections: tree.evolutions.reduce((sum, e) => sum + e.paths.length, 0),
    ...meta,
  };

  await writeFile(
    "../artifacts/publication/mammal-dna-v3-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "DNA v3 publication failed");
  process.exitCode = 1;
});
