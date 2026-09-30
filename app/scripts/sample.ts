import { mkdir, writeFile } from "node:fs/promises";
import { sampleMammal } from "../src/lib/rebyters/sample";
import {
  canonicalTree,
  contentHash,
  leafBytes,
} from "../src/lib/rebyters/canonical";
import { buildMerkleTree } from "../src/lib/rebyters/merkle";
import { registryPda, treePda, PROGRAM_ID } from "../src/lib/rebyters/config";
const tree = sampleMammal(),
  merkle = buildMerkleTree(tree);
await mkdir("../artifacts/sample", { recursive: true });
await writeFile("../artifacts/sample/mammal-v1.json", canonicalTree(tree));
await writeFile(
  "../artifacts/sample/merkle-fixture.json",
  JSON.stringify(
    {
      canonicalLeaf: new TextDecoder().decode(
        leafBytes(tree, tree.evolutions[1]),
      ),
      siblings: merkle.getEvolutionProof(tree.evolutions[1].id).siblings,
      root: merkle.root,
    },
    null,
    2,
  ),
);
const report = {
  status: "LOCAL SAMPLE ONLY: IDs are illustrative until reserved on-chain",
  programId: PROGRAM_ID.toBase58(),
  registryPda: registryPda().toBase58(),
  mammalV1Pda: treePda(0, 1).toBase58(),
  merkleRoot: merkle.root,
  contentHash: contentHash(tree),
  irysUri: null,
};
await writeFile(
  "../artifacts/sample/report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
