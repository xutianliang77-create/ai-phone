#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (takeFlag("--help") || takeFlag("-h")) {
  usage();
  process.exit(0);
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = takeOption("--repo") ?? "FluidInference/qwen3-asr-0.6b-coreml";
const revision = takeOption("--revision") ?? "main";
const endpoint = normalizeEndpoint(
  takeOption("--endpoint") ?? process.env.HF_ENDPOINT ?? "https://huggingface.co"
);
const variant = normalizeVariant(takeOption("--variant") ?? process.env.QWEN3_COREML_VARIANT ?? "int8");
const outputRoot = path.resolve(
  takeOption("--output") ??
    `.cache/ios-qwen3-asr-coreml/${repo.replace("/", "--")}/${variant}`
);
const deviceId = takeOption("--device") ??
  process.env.IPHONE14_DEVICE_ID ??
  "F7974451-E824-5DC1-AA00-24F1DD004C7A";
const bundleId = takeOption("--bundle-id") ??
  process.env.IPHONE14_TEST_BUNDLE_ID ??
  "com.translationlab.iphone14ModelTester";
const destinationRoot = takeOption("--destination") ??
  `Documents/Models/Qwen3ASRCoreML/${variant}`;
const token = takeOption("--token") ??
  process.env.HF_TOKEN ??
  process.env.HUGGINGFACE_TOKEN ??
  "";
const treeJson = takeOption("--tree-json");
const dryRun = takeFlag("--dry-run");
const download = takeFlag("--download");
const downloadOnly = takeFlag("--download-only");
const force = takeFlag("--force");
const includeMlpackage = takeFlag("--include-mlpackage");

if (args.length > 0) {
  usage();
  process.exit(1);
}

const tree = await loadTree();
const files = selectedFiles(tree);
const summary = {
  repo,
  revision,
  variant,
  endpoint,
  outputRoot: relative(outputRoot),
  destinationRoot,
  deviceId,
  bundleId,
  download,
  downloadOnly,
  dryRun,
  force,
  includeMlpackage,
  fileCount: files.length,
  totalBytes: files.reduce((sum, file) => sum + (file.size ?? 0), 0),
  files: files.map((file) => ({
    path: file.remotePath,
    size: file.size ?? null,
    destination: relative(destinationFor(file)),
  })),
};

console.log(JSON.stringify(summary, null, 2));

if (dryRun) {
  process.exit(0);
}

if (download || downloadOnly) {
  mkdirSync(outputRoot, { recursive: true });
  for (const file of files) {
    await downloadFile(file);
  }
}

validateLocalModel();
if (downloadOnly) {
  console.log(`Qwen3-ASR CoreML ${variant} download finished: ${relative(outputRoot)}`);
  process.exit(0);
}
stageLocalModel();
console.log(`Qwen3-ASR CoreML ${variant} staging finished. Reopen the iPhone14 test app and select CoreML Qwen3-ASR.`);

async function loadTree() {
  if (treeJson) {
    return normalizeTree(JSON.parse(readFileSync(path.resolve(treeJson), "utf8")));
  }
  const url = `${endpoint}/api/models/${repo}/tree/${revision}?recursive=true`;
  return normalizeTree(await fetchJson(url));
}

function normalizeTree(payload) {
  const values = Array.isArray(payload) ? payload : payload.siblings;
  if (!Array.isArray(values)) {
    throw new Error("Hugging Face tree response was not an array.");
  }
  return values
    .filter((entry) => (entry.type ?? "file") !== "directory")
    .map((entry) => ({
      remotePath: entry.path ?? entry.rfilename,
      size: typeof entry.size === "number" ? entry.size : null,
    }))
    .filter((entry) => typeof entry.remotePath === "string");
}

function selectedFiles(entries) {
  const prefix = `${variant}/`;
  const selected = entries.filter((entry) => {
    if (entry.remotePath === "config.json") return true;
    if (!entry.remotePath.startsWith(prefix)) return false;
    if (!includeMlpackage && entry.remotePath.includes(".mlpackage/")) return false;
    return [
      "metadata.json",
      "vocab.json",
      "qwen3_asr_embeddings.bin",
      "qwen3_asr_audio_encoder.mlmodelc/",
      "qwen3_asr_audio_encoder_v2.mlmodelc/",
      "qwen3_asr_decoder_stateful.mlmodelc/",
    ].some((name) => entry.remotePath === `${prefix}${name}` || entry.remotePath.startsWith(`${prefix}${name}`));
  });
  if (selected.length === 0) {
    throw new Error(`No downloadable files found for ${repo}@${revision}/${variant}`);
  }
  return selected.sort((a, b) => a.remotePath.localeCompare(b.remotePath));
}

async function downloadFile(file) {
  const destination = destinationFor(file);
  if (!force && existsSync(destination) && sizeMatches(destination, file.size)) {
    console.log(`skip ${file.remotePath}`);
    return;
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  const temp = `${destination}.part`;
  if (force) {
    rmSync(temp, { force: true });
  }
  const url = resolveUrl(file.remotePath);
  curlDownload(url, temp, file.size);
  renameSync(temp, destination);
  console.log(`downloaded ${file.remotePath}`);
}

function validateLocalModel() {
  const required = [
    "metadata.json",
    "vocab.json",
    "qwen3_asr_embeddings.bin",
    "qwen3_asr_audio_encoder.mlmodelc",
    "qwen3_asr_audio_encoder_v2.mlmodelc",
    "qwen3_asr_decoder_stateful.mlmodelc",
  ];
  const missing = required.filter((name) => !existsSync(path.join(outputRoot, name)));
  if (missing.length > 0) {
    throw new Error(
      `Missing local Qwen3 CoreML files in ${relative(outputRoot)}: ${missing.join(", ")}. Run with --download first.`
    );
  }
}

function stageLocalModel() {
  const entries = readdirSync(outputRoot)
    .filter((name) => !name.startsWith("."))
    .sort();
  for (const entry of entries) {
    const source = path.join(outputRoot, entry);
    const destination = `${destinationRoot}/${path.basename(entry)}`;
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
}

function destinationFor(file) {
  if (file.remotePath === "config.json") {
    return path.join(outputRoot, "config.json");
  }
  return path.join(outputRoot, file.remotePath.slice(variant.length + 1));
}

function resolveUrl(filePath) {
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  return `${endpoint}/${repo}/resolve/${revision}/${encoded}`;
}

function sizeMatches(filePath, expectedSize) {
  if (typeof expectedSize !== "number") return true;
  return statSync(filePath).size === expectedSize;
}

function spawnChecked(command, spawnArgs) {
  const result = spawnSync(command, spawnArgs, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${spawnArgs.join(" ")} failed with ${result.status}`);
  }
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return await response.json();
  } catch {
    const curlArgs = ["-L", "--silent", "--show-error", "--fail"];
    if (token) curlArgs.push("-H", `Authorization: Bearer ${token}`);
    curlArgs.push(url);
    const result = spawnSync("curl", curlArgs, { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`curl ${url} failed: ${result.stderr.trim()}`);
    }
    return JSON.parse(result.stdout);
  }
}

function curlDownload(url, destination, expectedSize) {
  const resumable = typeof expectedSize === "number" && expectedSize > 1024 * 1024;
  let lastError = "";
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    if (!resumable) {
      rmSync(destination, { force: true });
    }
    const curlArgs = [
      "-L",
      "--fail",
      "--silent",
      "--show-error",
      "--retry",
      "5",
      "--retry-delay",
      "2",
      "--retry-connrefused",
    ];
    if (resumable) {
      curlArgs.push("--continue-at", "-");
    }
    curlArgs.push("--output", destination);
    if (token) curlArgs.push("-H", `Authorization: Bearer ${token}`);
    curlArgs.push(url);
    const result = spawnSync("curl", curlArgs, { encoding: "utf8" });
    if (result.status === 0) return;
    lastError = (result.stderr ?? "").trim();
    console.error(`download retry ${attempt}/6 failed: ${lastError}`);
    spawnSync("sleep", [String(attempt * 2)]);
  }
  throw new Error(`curl ${url} failed after retries: ${lastError}`);
}

function normalizeVariant(value) {
  const lowered = value.toLowerCase();
  if (lowered !== "int8" && lowered !== "f32") {
    throw new Error("--variant must be int8 or f32");
  }
  return lowered;
}

function normalizeEndpoint(value) {
  return value.replace(/\/+$/, "");
}

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function takeOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`${name} requires a value.`);
    process.exit(1);
  }
  args.splice(index, 2);
  return value;
}

function relative(filePath) {
  return filePath.startsWith(rootDir) ? filePath.slice(rootDir.length + 1) : filePath;
}

function usage() {
  console.log(`Usage:
  scripts/iphone14_stage_qwen3_asr_coreml_model.mjs [--variant int8|f32] [--download] [--dry-run]

Downloads and stages FluidInference/qwen3-asr-0.6b-coreml into the independent
iPhone14 model tester app sandbox.

Options:
  --variant NAME          int8 or f32. Default: int8
  --download              Download selected CoreML files before staging
  --download-only         Download and validate without staging to iPhone
  --include-mlpackage     Also download .mlpackage source files
  --output DIR            Override local cache directory
  --device ID             Override iPhone device id
  --bundle-id ID          Override test app bundle id
  --destination PATH      Override app sandbox destination
  --repo REPO             Default: FluidInference/qwen3-asr-0.6b-coreml
  --revision REV          Default: main
  --endpoint URL          Default: https://huggingface.co. Also reads HF_ENDPOINT
  --force                 Redownload existing files
  --token TOKEN           Hugging Face token. Also reads HF_TOKEN/HUGGINGFACE_TOKEN
  --tree-json FILE        Use a saved Hugging Face tree response
  --dry-run               Print plan only

Examples:
  npm run iphone14:stage:qwen3-coreml -- --variant int8 --download --dry-run
  npm run iphone14:stage:qwen3-coreml -- --variant int8 --download`);
}
