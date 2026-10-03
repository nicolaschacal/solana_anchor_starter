import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Connection, Keypair } from "@solana/web3.js";
import { Wallet } from "@anchor-lang/core";
import { Uploader } from "@irys/upload";
import { Solana } from "@irys/upload-solana";
import { RegistryWriter, fetchRegistry, fetchTree } from "../src/lib/rebyters/registry";
import { sendInstruction } from "../src/lib/rebyters/transactions";
import { publishTree, type PublishJournal } from "../src/lib/rebyters/publish";
import { buildMammalDnaV3Upgrade } from "../src/lib/rebyters/sample";
import { fetchVerifiedTree } from "../src/lib/rebyters/tree";
import { PROGRAM_ID, registryPda, treePda } from "../src/lib/rebyters/config";
import { canonicalTree, contentHash } from "../src/lib/rebyters/canonical";

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

  const activeVersion = registry.activeVersions[0];
  if (!activeVersion) throw new Error("Mammal has no active atlas");

  const activeMeta = await fetchTree(connection, 0, activeVersion);
  if (!activeMeta) throw new Error("Active Mammal metadata is missing");
  const previous = await fetchVerifiedTree(activeMeta);

  await mkdir("../artifacts/publication", { recursive: true });

  let journal: PublishJournal | undefined;
  try {
    journal = JSON.parse(await readFile(journalFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  if (journal) {
    if (journal.baseVersion !== activeVersion) {
      throw new Error("Pending DNA v3 publication has a stale base version");
    }
  } else {
    const tree = buildMammalDnaV3Upgrade(previous, registry.nextVersions[0]);
    journal = {
      tree,
      baseVersion: activeVersion,
      replaceCollection: false,
    };
    await writeFile(journalFile, JSON.stringify(journal, null, 2));
  }

  if (journal.tree.proofMode !== "unified-v1") {
    throw new Error("DNA v3 requires unified-v1 atlas proofs");
  }

  console.log(
    JSON.stringify(
      {
        status: "Preparing DNA v3 atlas",
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
