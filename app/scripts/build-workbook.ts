import { readFile, writeFile } from "node:fs/promises";
import { compileWorkbook } from "../src/lib/rebyters/workbook-rules";
import { validateTree } from "../src/lib/rebyters/validation";

const raw = JSON.parse(await readFile("src/lib/rebyters/mammal.workbook.json", "utf8"));
const tree = validateTree(compileWorkbook(raw));
await writeFile("src/lib/rebyters/mammal.seed.json", JSON.stringify(tree, null, 2) + "\n");
console.log(`Compiled ${tree.evolutions.length} forms and ${tree.evolutions.reduce((n,e) => n+e.paths.length,0)} structured rules; balance ${tree.balance!.version}`);
