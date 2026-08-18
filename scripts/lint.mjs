import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const roots = ["lib", "services"];
const sourceExtensions = new Set([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
// node_modules/dist/build dirs get vendored or generated once any services/*
// package runs its own `npm install` (e.g. services/web, services/api) —
// without this exclusion the walk scans thousands of vendored files and
// blows past CI's timeout (see CLAUDE.md's CI-widening-session learning).
const skipDirs = new Set(["node_modules", "dist", "build", ".git"]);
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
    if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
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
