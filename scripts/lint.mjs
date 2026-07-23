import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const roots = ["lib", "services"];
const sourceExtensions = new Set([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const failures = [];

async function visit(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(path);
    } else if (sourceExtensions.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
      const lines = (await readFile(path, "utf8")).split(/\r?\n/);
      lines.forEach((line, index) => {
        if (/[ \t]+$/.test(line)) failures.push(`${path}:${index + 1}: trailing whitespace`);
        if (line.includes("\t")) failures.push(`${path}:${index + 1}: tab character`);
      });
    }
  }
}

await Promise.all(roots.map(visit));

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
