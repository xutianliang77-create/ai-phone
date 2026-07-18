#!/usr/bin/env node
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";

const args = process.argv.slice(2);
if (takeFlag("--help") || takeFlag("-h")) {
  usage();
  process.exit(0);
}

const repo = "FluidInference/silero-vad-coreml";
const revision = takeOption("--revision") ?? "main";
const endpoint = (
  takeOption("--endpoint") ??
  process.env.HF_ENDPOINT ??
  "https://huggingface.co"
).replace(/\/+$/, "");
const modelFolder = "silero-vad-unified-256ms-v6.0.0.mlmodelc";
const output = path.resolve(
  takeOption("--output") ?? `.cache/ios-vad/${modelFolder}`,
);
const stage = takeFlag("--stage");
const force = takeFlag("--force");
const dryRun = takeFlag("--dry-run");
const token =
  takeOption("--token") ??
  process.env.HF_TOKEN ??
  process.env.HUGGINGFACE_TOKEN ??
  "";

if (args.length > 0) {
  usage();
  process.exit(1);
}

const response = await fetch(
  `${endpoint}/api/models/${repo}/tree/${revision}?recursive=true`,
  { headers: token ? { authorization: `Bearer ${token}` } : {} },
);
if (!response.ok) {
  throw new Error(
    `Hugging Face tree request failed: ${response.status} ${response.statusText}`,
  );
}
const tree = await response.json();
const files = tree
  .filter(
    (entry) =>
      entry.type === "file" && entry.path.startsWith(`${modelFolder}/`),
  )
  .map((entry) => ({
    remotePath: entry.path,
    relativePath: entry.path.slice(modelFolder.length + 1),
    size: typeof entry.size === "number" ? entry.size : null,
  }));

if (files.length === 0) {
  throw new Error(`${modelFolder} was not found in ${repo}@${revision}`);
}

const plan = {
  repo,
  revision,
  endpoint,
  output,
  stage,
  fileCount: files.length,
  totalBytes: files.reduce((sum, file) => sum + (file.size ?? 0), 0),
  files,
};
if (dryRun) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

mkdirSync(output, { recursive: true });
for (const file of files) {
  await download(file);
}
validateBundle(output);

if (stage) {
  const destination = path.resolve(
    "apps/mobile/ios/Runner/Models/vad",
    modelFolder,
  );
  if (existsSync(destination)) {
    if (!force) {
      throw new Error(
        `${destination} already exists; pass --force to replace it`,
      );
    }
    rmSync(destination, { recursive: true, force: true });
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(output, destination, { recursive: true });
  validateBundle(destination);
  console.log(`staged ${destination}`);
}

console.log(
  JSON.stringify(
    {
      repo,
      revision,
      output,
      staged: stage,
      fileCount: files.length,
    },
    null,
    2,
  ),
);

async function download(file) {
  const destination = path.join(output, file.relativePath);
  if (
    !force &&
    existsSync(destination) &&
    (file.size === null || statSync(destination).size === file.size)
  ) {
    console.log(`skip ${file.remotePath}`);
    return;
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.part`;
  rmSync(temporary, { force: true });
  const encoded = file.remotePath.split("/").map(encodeURIComponent).join("/");
  const result = await fetch(
    `${endpoint}/${repo}/resolve/${revision}/${encoded}`,
    { headers: token ? { authorization: `Bearer ${token}` } : {} },
  );
  if (!result.ok || !result.body) {
    throw new Error(
      `Download failed for ${file.remotePath}: ${result.status} ${result.statusText}`,
    );
  }
  await pipeline(result.body, createWriteStream(temporary));
  renameSync(temporary, destination);
  console.log(`downloaded ${file.remotePath}`);
}

function validateBundle(directory) {
  const required = [
    "coremldata.bin",
    "metadata.json",
    "model.mil",
    "weights/weight.bin",
  ];
  const missing = required.filter(
    (relativePath) => !existsSync(path.join(directory, relativePath)),
  );
  if (missing.length > 0) {
    throw new Error(
      `Silero VAD bundle is incomplete: ${missing.join(", ")}`,
    );
  }
}

function takeFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function takeOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  args.splice(index, 2);
  return value;
}

function usage() {
  console.log(`Usage:
  scripts/download_ios_silero_vad_bundle.mjs [--stage] [--force] [--dry-run]

Downloads FluidAudio's pinned Silero VAD Core ML bundle and optionally stages it
under apps/mobile/ios/Runner/Models/vad for offline iOS builds.

Options:
  --endpoint URL   Hugging Face endpoint; also reads HF_ENDPOINT
  --revision REV   Repository revision. Default: main
  --output DIR     Download destination
  --stage          Copy into the Runner Models resource folder
  --force          Replace existing files
  --token TOKEN    Hugging Face token
  --dry-run        Print the download plan only`);
}
