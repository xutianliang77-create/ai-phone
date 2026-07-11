#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeDomesticReleaseMaterialsDraft } from "./lib/domestic_release_materials_scaffold.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const overwrite = takeFlag("--overwrite");
const output =
  valueFlag("--output") ?? "release/domestic/release-materials.todo.json";

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = writeDomesticReleaseMaterialsDraft({ root, output, overwrite });
if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log(`Domestic release materials draft written: ${result.output}`);
  console.log(
    `Remaining required fields: ${result.remainingRequiredFields.join(", ")}`,
  );
  console.log(
    "Set RELEASE_MATERIALS_FILE after replacing all placeholders with real reviewed materials.",
  );
} else {
  console.error(result.issue);
  console.error(`Existing file: ${result.output}`);
}

if (!result.ok) process.exit(1);

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function valueFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("-"))
    throw new Error(`${flag} requires a value`);
  args.splice(index, 2);
  return value;
}

function usage() {
  console.log(`Usage:
  scripts/scaffold_domestic_release_materials.mjs [--json]
  scripts/scaffold_domestic_release_materials.mjs --output release/domestic/release-materials.todo.json

Creates a domestic release materials draft with known app identity, legal
entity, accepted development APP ICP placeholder, and 3 screenshot paths per platform.
Run npm run generate:domestic-release-screenshots for baseline images.
Real legal URLs, owner, and privacy labels remain
incomplete so release-ready cannot be accidentally passed.`);
}
