#!/usr/bin/env node
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (takeFlag("--help") || takeFlag("-h")) {
  usage();
  process.exit(0);
}

const repo = takeOption("--repo") ??
  "FluidInference/Nemotron-3.5-ASR-Streaming-Multilingual-0.6b-CoreML";
const revision = takeOption("--revision") ?? "main";
const endpoint = normalizeEndpoint(
  takeOption("--endpoint") ?? process.env.HF_ENDPOINT ?? "https://huggingface.co"
);
const family = takeOption("--family") ?? "multilingual";
const tier = takeOption("--tier") ?? "2240ms";
const outputRoot = path.resolve(
  takeOption("--output") ??
    `.cache/ios-nemotron/${repo.replace("/", "--")}/${family}/${tier}`
);
const treeJson = takeOption("--tree-json");
const token = takeOption("--token") ??
  process.env.HF_TOKEN ??
  process.env.HUGGINGFACE_TOKEN ??
  "";
const dryRun = takeFlag("--dry-run");
const stage = takeFlag("--stage");
const force = takeFlag("--force");
const allowedFamilies = new Set(["multilingual", "latin"]);
const allowedTiers = new Set(["2240ms", "1120ms", "560ms", "4480ms"]);

if (args.length > 0) {
  usage();
  process.exit(1);
}
if (!allowedFamilies.has(family)) {
  console.error("Family must be one of: multilingual, latin.");
  process.exit(1);
}
if (!allowedTiers.has(tier)) {
  console.error("Tier must be one of: 2240ms, 1120ms, 560ms, 4480ms.");
  process.exit(1);
}

const remoteRoot = `${family}/${tier}`;
const tree = await loadTree();
const files = tree.filter((entry) => entry.type !== "directory");

if (files.length === 0) {
  console.error(`No files found under ${remoteRoot} in ${repo}@${revision}.`);
  process.exit(1);
}

const summary = {
  repo,
  revision,
  family,
  tier,
  remoteRoot,
  outputRoot,
  fileCount: files.length,
  totalBytes: files.reduce((sum, file) => sum + (file.size ?? 0), 0),
  dryRun,
  stage,
  force,
  files: files.map((file) => ({
    path: file.remotePath,
    size: file.size ?? null,
    destination: destinationFor(file),
  })),
};

if (dryRun) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

mkdirSync(outputRoot, { recursive: true });
for (const file of files) {
  await downloadFile(file);
}

const validation = spawnSync(
  process.execPath,
  ["scripts/validate_ios_nemotron_bundle.mjs", outputRoot],
  { cwd: process.cwd(), encoding: "utf8" }
);
process.stdout.write(validation.stdout);
process.stderr.write(validation.stderr);
if (validation.status !== 0) {
  process.exit(validation.status ?? 1);
}

if (stage) {
  const stageArgs = [
    "scripts/stage_ios_nemotron_bundle.mjs",
    outputRoot,
    "--family",
    family,
    "--tier",
    tier,
  ];
  if (force) stageArgs.push("--force");
  const staged = spawnSync(process.execPath, stageArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  process.stdout.write(staged.stdout);
  process.stderr.write(staged.stderr);
  if (staged.status !== 0) process.exit(staged.status ?? 1);
}

console.log(JSON.stringify({
  repo,
  revision,
  outputRoot,
  fileCount: files.length,
  staged: stage,
}, null, 2));

async function loadTree() {
  if (treeJson) {
    return normalizeTree(JSON.parse(readFileSync(path.resolve(treeJson), "utf8")));
  }
  const url = `${endpoint}/api/models/${repo}/tree/${revision}/${remoteRoot}?recursive=true`;
  const response = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error(`Hugging Face tree request failed: ${response.status} ${response.statusText}`);
  }
  return normalizeTree(await response.json());
}

function normalizeTree(payload) {
  const values = Array.isArray(payload) ? payload : payload.siblings;
  if (!Array.isArray(values)) {
    throw new Error("Hugging Face tree response was not an array.");
  }
  return values.map((entry) => ({
    ...normalizePath(entry.path ?? entry.rfilename),
    type: entry.type ?? "file",
    size: typeof entry.size === "number" ? entry.size : null,
  })).filter((entry) => typeof entry.relativePath === "string");
}

function normalizePath(value) {
  if (typeof value !== "string") return {};
  const trimmed = value.replace(/^\/+/, "");
  if (trimmed === remoteRoot) {
    return { remotePath: trimmed, relativePath: "" };
  }
  if (trimmed.startsWith(`${remoteRoot}/`)) {
    return {
      remotePath: trimmed,
      relativePath: trimmed.slice(remoteRoot.length + 1),
    };
  }
  for (const knownFamily of allowedFamilies) {
    if (trimmed === knownFamily || trimmed.startsWith(`${knownFamily}/`)) {
      return {};
    }
  }
  return {
    remotePath: `${remoteRoot}/${trimmed}`,
    relativePath: trimmed,
  };
}

async function downloadFile(file) {
  const destination = destinationFor(file);
  if (!force && existsSync(destination) && sizeMatches(destination, file.size)) {
    console.log(`skip ${file.remotePath}`);
    return;
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  const temp = `${destination}.part`;
  rmSync(temp, { force: true });
  const response = await fetch(resolveUrl(file.remotePath), {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed for ${file.remotePath}: ${response.status} ${response.statusText}`);
  }
  await pipeline(response.body, createWriteStream(temp));
  renameSync(temp, destination);
  console.log(`downloaded ${file.remotePath}`);
}

function destinationFor(file) {
  return path.join(outputRoot, file.relativePath);
}

function resolveUrl(filePath) {
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  return `${endpoint}/${repo}/resolve/${revision}/${encoded}`;
}

function sizeMatches(filePath, expectedSize) {
  if (typeof expectedSize !== "number") return true;
  return statSync(filePath).size === expectedSize;
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

function normalizeEndpoint(value) {
  return value.replace(/\/+$/, "");
}

function usage() {
  console.log(`Usage:
  scripts/download_ios_nemotron_bundle.mjs [--family multilingual] [--tier 2240ms] [--stage] [--force] [--dry-run]

Downloads one FluidInference Nemotron CoreML tier from Hugging Face into:
  .cache/ios-nemotron/<repo>/<family>/<tier>

Options:
  --repo REPO          Default: FluidInference/Nemotron-3.5-ASR-Streaming-Multilingual-0.6b-CoreML
  --revision REV      Default: main
  --endpoint URL      Default: https://huggingface.co. Also reads HF_ENDPOINT
  --family NAME       multilingual or latin. Default: multilingual
  --tier NAME         2240ms, 1120ms, 560ms, or 4480ms. Default: 2240ms
  --output DIR        Override local download destination
  --stage             Copy the validated bundle into apps/mobile/ios/Runner/Models
  --force             Redownload and replace any staged destination
  --token TOKEN       Hugging Face token. Also reads HF_TOKEN or HUGGINGFACE_TOKEN
  --tree-json FILE    Use a saved Hugging Face tree response for offline dry-run tests
  --dry-run           Print the file plan without downloading

Example:
  scripts/download_ios_nemotron_bundle.mjs --family multilingual --tier 2240ms --stage`);
}
