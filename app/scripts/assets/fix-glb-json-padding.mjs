// Repairs GLB files whose JSON chunk is padded with NUL bytes instead of spaces.
// The glTF spec requires 0x20 padding; three.js GLTFLoader and glTF-Transform
// reject NUL padding ("Unexpected non-whitespace character after JSON"), which
// makes the asset silently fail to load. Only padding bytes are rewritten.
// Usage: node scripts/assets/fix-glb-json-padding.mjs FILE.glb [FILE.glb ...]
import fs from "node:fs";

let fixed = 0;
for (const file of process.argv.slice(2)) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) {
    console.log(`skip ${file}: not a GLB`);
    continue;
  }
  const jsonLength = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) {
    console.log(`skip ${file}: first chunk is not JSON`);
    continue;
  }
  const start = 20;
  const end = start + jsonLength;
  let changed = 0;
  // Only trailing NULs (padding) are touched; real JSON ends with "}".
  for (let i = end - 1; i >= start && buf[i] === 0; i--) {
    buf[i] = 0x20;
    changed++;
  }
  if (changed) {
    fs.writeFileSync(file, buf);
    fixed++;
  }
  console.log(`${changed ? "fixed" : "ok   "} ${file}${changed ? ` (${changed} padding bytes)` : ""}`);
}
console.log(`${fixed} file(s) repaired`);
