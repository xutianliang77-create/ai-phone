#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prepareAir780LuatoolsBundle } from
  "./lib/air780_luatools_bundle.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const firmwareRoot = resolve(
  scriptDirectory,
  "../firmware/air780-livekit-bridge",
);
const args = process.argv.slice(2);
const options = new Map();
let valid = args.length === 2 || args.length === 4;
for (let index = 0; index < args.length; index += 2) {
  const name = args[index];
  const value = args[index + 1];
  if (!["--output", "--manifest"].includes(name) || !value ||
    options.has(name)) valid = false;
  options.set(name, value);
}
const outputDirectory = options.get("--output") ?? "";
const manifestName = options.get("--manifest") ?? "PROD_FLASH_MANIFEST.tsv";
const allowedManifests = new Set([
  "PROD_FLASH_MANIFEST.tsv",
  "PROD_USB_FLASH_MANIFEST.tsv",
]);

if (!valid || !outputDirectory || !allowedManifests.has(manifestName)) {
  console.error(
    "Usage: node scripts/prepare_air780_luatools_bundle.mjs " +
      "[--manifest PROD_USB_FLASH_MANIFEST.tsv] --output <empty-directory>",
  );
  process.exitCode = 2;
} else {
  prepareAir780LuatoolsBundle({ firmwareRoot, outputDirectory, manifestName })
    .then((summary) => console.log(JSON.stringify(summary, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
