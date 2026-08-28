import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["apps", "services", "packages", "scripts", "tools"];
const ignored = new Set([
  "node_modules",
  "dist",
  ".dart_tool",
  ".gradle",
  ".symlinks",
  "build",
  "ephemeral",
  "Pods",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
]);
const extensions = new Set([".ts", ".tsx", ".dart", ".py", ".mjs"]);
const maxLines = 350;
const violations = [];

function extOf(path) {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? "" : path.slice(idx);
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (ignored.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    if (!extensions.has(extOf(path))) continue;
    const source = readFileSync(path, "utf8");
    const lines = source.length === 0
      ? 0
      : source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
    if (lines > maxLines) violations.push(`${path}: ${lines} lines`);
  }
}

for (const root of roots) {
  try {
    if (statSync(root).isDirectory()) walk(root);
  } catch {
    // Missing roots are fine during early scaffolding.
  }
}

if (violations.length > 0) {
  console.error("Files exceed max line limit:");
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("File size check passed.");
