import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Connection, Keypair } from "@solana/web3.js";
import { Wallet } from "@anchor-lang/core";
import { Uploader } from "@irys/upload";
import { Solana } from "@irys/upload-solana";
import { RegistryWriter, fetchRegistry, fetchTree } from "../src/lib/rebyters/registry";
import { sendInstruction } from "../src/lib/rebyters/transactions";
import { publishTree, type PublishJournal } from "../src/lib/rebyters/publish";
import {
  buildCurrentMammalRebalance,
} from "../src/lib/rebyters/sample";
import { fetchVerifiedTreeForMigration } from "../src/lib/rebyters/tree";
import { PROGRAM_ID, registryPda, treePda } from "../src/lib/rebyters/config";
import { canonicalTree, contentHash } from "../src/lib/rebyters/canonical";
import { validateTree } from "../src/lib/rebyters/validation";

const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const walletPath =
  process.env.SOLANA_WALLET_PATH || "../artifacts/private/admin-keypair.json";
const irysPath = process.env.IRYS_WALLET_PATH || walletPath;
const journalFile = "../artifacts/publication/mammal-rebalance-pending.json";

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
  if (genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG")
    throw new Error("Mammal rebalance publisher is restricted to Solana devnet");

  const deployed = await connection.getAccountInfo(PROGRAM_ID);
  if (!deployed?.executable)
    throw new Error("Deploy the current Rebyters program before publishing the atlas");

  const writer = new RegistryWriter(connection, wallet, instruction =>
    sendInstruction(connection, wallet, instruction, console.log),
  );
  const registry = await fetchRegistry(connection);
  if (!registry || registry.authority !== signer.publicKey.toBase58())
    throw new Error("Configured wallet is not the registry authority");

  const activeVersion = registry.activeVersions[0];
  if (!activeVersion) throw new Error("Mammal has no active atlas");
  const activeMeta = await fetchTree(connection, 0, activeVersion);
  if (!activeMeta) throw new Error("Active Mammal atlas metadata is missing");
  const previous = await fetchVerifiedTreeForMigration(activeMeta);

  await mkdir("../artifacts/publication", { recursive: true });
  const nextVersion = registry.nextVersions[0];

  let journal: PublishJournal | undefined;
  try {
    const pending = JSON.parse(await readFile(journalFile, "utf8")) as PublishJournal;
    if (
      pending.baseVersion === activeVersion &&
      pending.tree.version === nextVersion &&
      pending.replaceCollection === false &&
      pending.tree.balance?.version === "mammal-current-physiology-2"
    ) {
      validateTree(pending.tree);
      journal = pending;
      console.log("Reusing Mammal rebalance pending publication");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.log("Ignoring stale current-generation publication journal");
  }

  if (!journal) {
    const tree = buildCurrentMammalRebalance(previous, nextVersion);
    validateTree(tree);
    journal = {
      tree,
      baseVersion: activeVersion,
      replaceCollection: false,
    };
    await writeFile(journalFile, JSON.stringify(journal, null, 2));
  }

  if (!journal) throw new Error("Current publication journal could not be created");
  const publishJournal: PublishJournal = journal;
  console.log(
    JSON.stringify(
      {
        status: "Preparing Mammal balance update",
        fromVersion: activeVersion,
        toVersion: publishJournal.tree.version,
        creatures: publishJournal.tree.evolutions.length,
        connections: publishJournal.tree.evolutions.reduce(
          (sum, evolution) => sum + evolution.paths.length,
          0,
        ),
        contentHash: contentHash(publishJournal.tree),
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
    publishJournal,
    async () => {
      const irysSigner = await keypair(irysPath);
      const irys = await Uploader(Solana)
        .withWallet(irysSigner.secretKey)
        .withRpc(rpc)
        .devnet();

      const payloadBytes = new TextEncoder().encode(
        canonicalTree(publishJournal.tree),
      ).length;
      const price = await irys.getPrice(payloadBytes);
      let balance = await irys.getLoadedBalance();
      const targetBalance = price.plus(price);

      if (balance.lt(targetBalance)) {
        const required = targetBalance.minus(balance);
        console.log("Funding Irys devnet upload buffer");
        await irys.fund(required);
        balance = await irys.getLoadedBalance();
        console.log(
          JSON.stringify(
            { irysLoadedBalanceAfterFundingAtomic: balance.toString() },
            null,
            2,
          ),
        );
      }

      return {
        upload: async (
          data: string | Uint8Array,
          options: { tags: { name: string; value: string }[] },
        ) => {
          const payload = typeof data === "string" ? data : Buffer.from(data);
          let lastError: unknown;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              return await irys.upload(payload, options);
            } catch (error) {
              lastError = error;
              const message =
                error instanceof Error ? error.message : String(error);
              if (!message.includes("402") || attempt === 3) throw error;
              console.log(
                `Irys devnet returned 402; retrying upload (${attempt}/3)...`,
              );
              await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
            }
          }
          throw lastError;
        },
      };
    },
    save,
    console.log,
    process.env.IRYS_GATEWAY || "https://gateway.irys.xyz",
  );

  const meta = await fetchTree(connection, 0, tree.version);
  await writeFile(
    "../artifacts/publication/mammal-rebalance.json",
    canonicalTree(tree),
  );

  const report = {
    status: "Mammal balance update published and activated on devnet",
    programId: PROGRAM_ID.toBase58(),
    registryPda: registryPda().toBase58(),
    treePda: treePda(0, tree.version).toBase58(),
    creatures: tree.evolutions.length,
    connections: tree.evolutions.reduce((sum, e) => sum + e.paths.length, 0),
    ...meta,
  };

  await writeFile(
    "../artifacts/publication/mammal-rebalance-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Mammal rebalance publication failed");
  process.exitCode = 1;
});
