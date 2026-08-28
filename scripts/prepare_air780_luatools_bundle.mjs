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
const outputIndex = process.argv.indexOf("--output");
const outputDirectory = outputIndex >= 0 ? process.argv[outputIndex + 1] : "";

if (!outputDirectory || process.argv.length !== 4 || outputIndex !== 2) {
  console.error(
    "Usage: node scripts/prepare_air780_luatools_bundle.mjs --output <empty-directory>",
  );
  process.exitCode = 2;
} else {
  prepareAir780LuatoolsBundle({ firmwareRoot, outputDirectory })
    .then((summary) => console.log(JSON.stringify(summary, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
