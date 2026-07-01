import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function collectJsFiles(dir) {
  const result = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) result.push(...collectJsFiles(path));
    if (stat.isFile() && path.endsWith(".mjs")) result.push(path);
  }
  return result;
}

const files = collectJsFiles(fileURLToPath(new URL("..", import.meta.url)));
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}
console.log(`Checked ${files.length} JavaScript modules.`);
