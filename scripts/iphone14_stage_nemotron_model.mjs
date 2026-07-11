import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deviceId = process.env.IPHONE14_DEVICE_ID ?? "F7974451-E824-5DC1-AA00-24F1DD004C7A";
const bundleId = process.env.IPHONE14_TEST_BUNDLE_ID ?? "com.translationlab.iphone14ModelTester";
const sourceDir = resolve(
  process.env.IPHONE14_NEMOTRON_MODEL_DIR
    ?? "apps/mobile/ios/Runner/Models/multilingual/2240ms",
);
const destinationRoot = process.env.IPHONE14_NEMOTRON_DEST
  ?? "Documents/Models/multilingual/2240ms";
const dryRun = process.argv.includes("--dry-run");

if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
  throw new Error(`Missing Nemotron model directory: ${sourceDir}`);
}

const entries = readdirSync(sourceDir)
  .filter((name) => !name.startsWith("."))
  .sort();

if (entries.length === 0) {
  throw new Error(`Nemotron model directory is empty: ${sourceDir}`);
}

console.log(JSON.stringify({
  deviceId,
  bundleId,
  sourceDir: relative(sourceDir),
  destinationRoot,
  entries,
  dryRun,
}, null, 2));

if (dryRun) {
  process.exit(0);
}

for (const entry of entries) {
  const source = resolve(sourceDir, entry);
  const destination = `${destinationRoot}/${basename(entry)}`;
  console.log(`copy ${relative(source)} -> ${destination}`);
  spawnChecked("xcrun", [
    "devicectl", "device", "copy", "to",
    "--device", deviceId,
    "--domain-type", "appDataContainer",
    "--domain-identifier", bundleId,
    "--source", source,
    "--destination", destination,
  ]);
}

console.log("Nemotron model staging finished. Reopen the test app or refresh native status, then select CoreML Nemotron.");

function spawnChecked(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
  }
}

function relative(path) {
  return path.startsWith(rootDir) ? path.slice(rootDir.length + 1) : path;
}
