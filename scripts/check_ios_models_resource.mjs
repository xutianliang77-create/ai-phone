#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
if (takeFlag("--help") || takeFlag("-h")) {
  usage();
  process.exit(0);
}
const requireReadyModel = takeFlag("--require-ready-model");
const requireVadModel = takeFlag("--require-vad-model");

const pbxprojPath = path.resolve("apps/mobile/ios/Runner.xcodeproj/project.pbxproj");
const builtAppPath = path.resolve(
  args.shift() ?? "apps/mobile/build/ios/iphonesimulator/Runner.app"
);
if (args.length > 0) {
  usage();
  process.exit(1);
}
const project = readFileSync(pbxprojPath, "utf8");
const hasFileReference = /\/\* Models \*\/ = \{isa = PBXFileReference;[^}]*path = Models;/.test(project);
const hasResourceBuildFile = /\/\* Models in Resources \*\/ = \{isa = PBXBuildFile;/.test(project);
const hasResourcesEntry = /[A-Z0-9]+ \/\* Models in Resources \*\/,/.test(project);
const builtModelsPath = path.join(builtAppPath, "Models");
const builtAppSizeBytes = directorySizeBytes(builtAppPath);
const builtModelsSizeBytes = directorySizeBytes(builtModelsPath);
const modelReports = existsSync(builtModelsPath)
  ? defaultModelRoots(builtModelsPath).map(inspectRoot)
  : [];
const selectedModel = modelReports.find((report) => report.bundleDetected) ??
  modelReports[0];
const vadModel = inspectVadModel(builtModelsPath);

const result = {
  project: {
    hasFileReference,
    hasResourceBuildFile,
    hasResourcesEntry,
  },
  builtApp: {
    path: builtAppPath,
    exists: existsSync(builtAppPath),
    hasModelsDirectory: existsSync(builtModelsPath),
    sizeBytes: builtAppSizeBytes,
    sizeMiB: bytesToMiB(builtAppSizeBytes),
    modelsSizeBytes: builtModelsSizeBytes,
    modelsSizeMiB: bytesToMiB(builtModelsSizeBytes),
  },
  model: {
    requireReadyModel,
    status: selectedModel?.status ?? "not_checked",
    root: selectedModel?.root ?? null,
    layout: selectedModel?.layout ?? "missing",
    missing: selectedModel?.missing ?? [],
    sizeBytes: selectedModel?.sizeBytes ?? null,
    sizeMiB: selectedModel?.sizeMiB ?? null,
    reportCount: modelReports.length,
  },
  vad: {
    required: requireVadModel,
    ...vadModel,
  },
};

console.log(JSON.stringify(result, null, 2));

if (!hasFileReference || !hasResourceBuildFile || !hasResourcesEntry) {
  console.error("Runner.xcodeproj does not include Models as a Runner resource.");
  process.exit(1);
}

if (existsSync(builtAppPath) && !result.builtApp.hasModelsDirectory) {
  console.error("Built Runner.app does not contain Models/.");
  process.exit(1);
}

if (requireReadyModel && result.model.status !== "ready") {
  console.error("Built Runner.app does not contain a FluidAudio-ready Nemotron model candidate.");
  process.exit(1);
}
if (requireVadModel && result.vad.status !== "ready") {
  console.error("Built Runner.app does not contain the FluidAudio Silero VAD model.");
  process.exit(1);
}

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function defaultModelRoots(modelsPath) {
  const roots = [path.join(modelsPath, "NemotronASRStreaming")];
  for (const family of ["multilingual", "latin"]) {
    for (const tier of ["2240ms", "1120ms", "560ms", "4480ms"]) {
      roots.push(path.join(modelsPath, family, tier));
    }
  }
  return roots;
}

function inspectRoot(root) {
  const sizeBytes = directorySizeBytes(root);
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
  const bundleDetected = existsSync(root) && (hasSplitCore || hasFusedCore);
  const missing = requiredMissing(components, hasSplitCore, hasFusedCore);
  const ready = bundleDetected && missing.length === 0;
  return {
    root,
    bundleDetected,
    status: ready ? "ready" : bundleDetected ? "model_incomplete" : "model_not_found",
    layout: hasFusedCore
      ? "fluid_split_fused"
      : hasSplitCore
        ? "split_encoder_decoder_joint"
        : "missing",
    missing,
    sizeBytes,
    sizeMiB: bytesToMiB(sizeBytes),
  };
}

function inspectVadModel(modelsPath) {
  const root = path.join(
    modelsPath,
    "vad",
    "silero-vad-unified-256ms-v6.0.0.mlmodelc",
  );
  const required = [
    "coremldata.bin",
    "metadata.json",
    "model.mil",
    "weights/weight.bin",
  ];
  const missing = required.filter(
    (relativePath) => !existsSync(path.join(root, relativePath)),
  );
  const exists = existsSync(root);
  return {
    root,
    status: exists && missing.length === 0
      ? "ready"
      : exists
        ? "model_incomplete"
        : "model_not_found",
    missing,
    sizeBytes: directorySizeBytes(root),
    sizeMiB: bytesToMiB(directorySizeBytes(root)),
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

function directorySizeBytes(targetPath) {
  if (!existsSync(targetPath)) return null;
  const stats = statSync(targetPath);
  if (stats.isFile()) return stats.size;
  if (!stats.isDirectory()) return null;
  let total = 0;
  for (const entry of readDirectory(targetPath)) {
    const child = path.join(targetPath, entry);
    const childSize = directorySizeBytes(child);
    if (childSize !== null) total += childSize;
  }
  return total;
}

function readDirectory(targetPath) {
  try {
    return readdirSync(targetPath);
  } catch {
    return [];
  }
}

function bytesToMiB(value) {
  return value === null ? null : Number((value / 1048576).toFixed(1));
}

function usage() {
  console.log(`Usage:
  scripts/check_ios_models_resource.mjs [--require-ready-model] [--require-vad-model] [BUILT_RUNNER_APP]

Checks that ios/Runner/Models is wired into the Runner target resources. If a
built Runner.app path exists, also checks that Models/ was copied into it.
With --require-ready-model, also checks Runner.app/Models for a FluidAudio-ready
Nemotron model candidate. With --require-vad-model, checks the staged FluidAudio
Silero VAD Core ML bundle.`);
}
