#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
if (takeFlag("--help") || takeFlag("-h")) {
  usage();
  process.exit(0);
}
const json = takeFlag("--json");
const allowMissing = takeFlag("--allow-missing");
const roots = args.length > 0 ? args.map((arg) => path.resolve(arg)) : defaultRoots();
const reports = roots.map(inspectRoot);
const selected = reports.find((report) => report.bundleDetected) ?? reports[0];
const summary = {
  status: selected?.status ?? "model_not_found",
  root: selected?.root ?? null,
  layout: selected?.layout ?? "missing",
  reports,
};

if (json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  printHumanSummary(summary);
}

if (summary.status !== "ready" && !allowMissing) process.exit(1);

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function usage() {
  console.log(`Usage:
  scripts/validate_ios_nemotron_bundle.mjs [--json] [--allow-missing] [MODEL_ROOT...]

Examples:
  scripts/validate_ios_nemotron_bundle.mjs apps/mobile/ios/Runner/Models/multilingual/2240ms
  scripts/validate_ios_nemotron_bundle.mjs --json --allow-missing

Default roots match the iOS app bundle candidates under apps/mobile/ios/Runner/Models.`);
}

function defaultRoots() {
  const base = path.resolve("apps/mobile/ios/Runner/Models");
  const roots = [path.join(base, "NemotronASRStreaming")];
  for (const family of ["multilingual", "latin"]) {
    for (const tier of ["2240ms", "1120ms", "560ms", "4480ms"]) {
      roots.push(path.join(base, family, tier));
    }
  }
  return roots;
}

function inspectRoot(root) {
  const components = componentPayload(root);
  const hasSplitCore = Boolean(components.encoder && components.decoder && components.joint);
  const hasFusedCore = Boolean(components.encoder && components.decoderJoint);
  const bundleDetected = existsSync(root) && (hasSplitCore || hasFusedCore);
  const fluidReady = bundleDetected &&
    Boolean(components.preprocessor && components.metadata && components.vocab);
  const missing = requiredMissing(components, hasSplitCore, hasFusedCore);

  return {
    root,
    exists: existsSync(root),
    bundleDetected,
    status: fluidReady ? "ready" : bundleDetected ? "model_incomplete" : "model_not_found",
    layout: hasFusedCore
      ? "fluid_split_fused"
      : hasSplitCore
        ? "split_encoder_decoder_joint"
        : "missing",
    missing,
    components,
  };
}

function componentPayload(root) {
  return {
    encoder: component(root, "encoder.mlmodelc", true),
    decoder: component(root, "decoder.mlmodelc", true),
    joint: component(root, "joint.mlmodelc", true),
    decoderJoint: component(root, "decoder_joint.mlmodelc", true),
    preprocessor: component(root, "preprocessor.mlmodelc", true),
    vocab: firstExisting(root, ["vocab.json", "tokenizer.json"]),
    languages: component(root, "languages.json"),
    config: component(root, "config.json"),
    metadata: component(root, "metadata.json"),
  };
}

function requiredMissing(components, hasSplitCore, hasFusedCore) {
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
  return directory || !name.endsWith(".mlmodelc") ? filePath : filePath;
}

function firstExisting(root, names) {
  for (const name of names) {
    const filePath = component(root, name);
    if (filePath) return filePath;
  }
  return null;
}

function printHumanSummary(summary) {
  console.log(`Nemotron CoreML bundle status: ${summary.status}`);
  if (summary.root) console.log(`Selected root: ${summary.root}`);
  console.log(`Layout: ${summary.layout}`);
  const selected = summary.reports.find((report) => report.root === summary.root);
  if (selected?.missing?.length) {
    console.log("Missing for FluidAudio readiness:");
    for (const item of selected.missing) console.log(`  - ${item}`);
  }
  if (summary.status !== "ready") {
    console.log("Use --json for all scanned candidate roots.");
  }
}
