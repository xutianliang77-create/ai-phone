#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
if (takeFlag("--help") || takeFlag("-h")) {
  usage();
  process.exit(0);
}

const dryRun = takeFlag("--dry-run");
const force = takeFlag("--force");
const family = takeOption("--family") ?? "multilingual";
const tier = takeOption("--tier") ?? "2240ms";
const sourceArg = args.shift();
const allowedFamilies = new Set(["multilingual", "latin"]);
const allowedTiers = new Set(["2240ms", "1120ms", "560ms", "4480ms"]);

if (!sourceArg || args.length > 0) {
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

const sourceRoot = path.resolve(sourceArg);
const runnerModelsRoot = path.resolve("apps/mobile/ios/Runner/Models");
const destinationRoot = path.join(runnerModelsRoot, family, tier);
const sourceReport = inspectRoot(sourceRoot);

if (sourceReport.status !== "ready") {
  printReport("Source bundle is not FluidAudio-ready", sourceReport);
  process.exit(1);
}

if (existsSync(destinationRoot) && !force) {
  console.error(`Destination already exists: ${destinationRoot}`);
  console.error("Use --force to replace this Runner model candidate.");
  process.exit(1);
}

const summary = {
  source: sourceRoot,
  destination: destinationRoot,
  family,
  tier,
  dryRun,
  force,
  status: "ready",
};

if (dryRun) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

mkdirSync(path.dirname(destinationRoot), { recursive: true });
if (existsSync(destinationRoot)) {
  rmSync(destinationRoot, { recursive: true, force: true });
}
cpSync(sourceRoot, destinationRoot, { recursive: true });

const destinationReport = inspectRoot(destinationRoot);
if (destinationReport.status !== "ready") {
  printReport("Destination bundle failed validation after copy", destinationReport);
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));

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

function usage() {
  console.log(`Usage:
  scripts/stage_ios_nemotron_bundle.mjs SOURCE_ROOT [--family multilingual] [--tier 2240ms] [--force] [--dry-run]

Stages a FluidAudio-ready Nemotron CoreML bundle into:
  apps/mobile/ios/Runner/Models/<family>/<tier>

The source must contain encoder.mlmodelc plus decoder_joint.mlmodelc, or
encoder.mlmodelc plus decoder.mlmodelc and joint.mlmodelc. It must also contain
preprocessor.mlmodelc, metadata.json, and tokenizer.json or vocab.json.`);
}

function inspectRoot(root) {
  const components = {
    encoder: component(root, "encoder.mlmodelc", true),
    decoder: component(root, "decoder.mlmodelc", true),
    joint: component(root, "joint.mlmodelc", true),
    decoderJoint: component(root, "decoder_joint.mlmodelc", true),
    preprocessor: component(root, "preprocessor.mlmodelc", true),
    metadata: component(root, "metadata.json"),
    vocab: firstExisting(root, ["vocab.json", "tokenizer.json"]),
  };
  const hasSplitCore = Boolean(components.encoder && components.decoder && components.joint);
  const hasFusedCore = Boolean(components.encoder && components.decoderJoint);
  const exists = existsSync(root);
  const bundleDetected = exists && (hasSplitCore || hasFusedCore);
  const missing = missingComponents(components, hasSplitCore, hasFusedCore);
  const ready = bundleDetected && missing.length === 0;
  return {
    root,
    exists,
    bundleDetected,
    status: ready ? "ready" : bundleDetected ? "model_incomplete" : "model_not_found",
    layout: hasFusedCore
      ? "fluid_split_fused"
      : hasSplitCore
        ? "split_encoder_decoder_joint"
        : "missing",
    missing,
  };
}

function missingComponents(components, hasSplitCore, hasFusedCore) {
  const missing = [];
  if (!hasSplitCore && !hasFusedCore) {
    if (!components.encoder) missing.push("encoder.mlmodelc");
    if (!components.decoder && !components.decoderJoint) {
      missing.push("decoder.mlmodelc or decoder_joint.mlmodelc");
    }
    if (components.decoder && !components.joint && !components.decoderJoint) {
      missing.push("joint.mlmodelc when decoder_joint.mlmodelc is absent");
    }
  }
  if (!components.preprocessor) missing.push("preprocessor.mlmodelc");
  if (!components.metadata) missing.push("metadata.json");
  if (!components.vocab) missing.push("vocab.json or tokenizer.json");
  return missing;
}

function component(root, name, directory = false) {
  const filePath = path.join(root, name);
  if (!existsSync(filePath)) return null;
  if (directory && !statSync(filePath).isDirectory()) return null;
  if (!directory && !statSync(filePath).isFile()) return null;
  return filePath;
}

function firstExisting(root, names) {
  for (const name of names) {
    const filePath = component(root, name);
    if (filePath) return filePath;
  }
  return null;
}

function printReport(message, report) {
  console.error(message);
  console.error(JSON.stringify(report, null, 2));
}
