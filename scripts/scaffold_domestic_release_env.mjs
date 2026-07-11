#!/usr/bin/env node
import process from "node:process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnvFile } from "./lib/domestic_release_env_file_check.mjs";
import { renderModelRoutingEnv } from "./lib/model_routing_config.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const overwrite = takeFlag("--overwrite") || takeFlag("--force");
const output = valueFlag("--output") ?? "release/domestic/release.env";
const example =
  valueFlag("--example") ?? "release/domestic/release.env.example";
const liveKitSnippet =
  valueFlag("--livekit-snippet") ??
  "infra/livekit-selfhost/generated/release.env.snippet";
const modelRoutingFile =
  valueFlag("--model-routing-file") ?? "release/domestic/model-routing.json";
const modelRoutingProfile = valueFlag("--model-routing-profile");

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = scaffoldDomesticReleaseEnv({
  root,
  output,
  example,
  liveKitSnippet,
  modelRoutingFile,
  modelRoutingProfile,
  overwrite,
});

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log(`Domestic release env draft written: ${result.output}`);
  console.log(`Applied sources: ${result.appliedSources.join(", ") || "none"}`);
  console.log(
    `Remaining placeholder keys: ${
      result.remainingPlaceholderKeys.join(", ") || "none"
    }`,
  );
  console.log(
    "Replace placeholders with real reviewed credentials before running release checks.",
  );
} else {
  console.error(result.issue);
  if (result.output) console.error(`Existing file: ${result.output}`);
}

if (!result.ok) process.exit(1);

function scaffoldDomesticReleaseEnv(options) {
  const examplePath = path.resolve(options.root, options.example);
  const outputPath = path.resolve(options.root, options.output);
  const liveKitSnippetPath = path.resolve(options.root, options.liveKitSnippet);
  const modelRoutingPath = path.resolve(options.root, options.modelRoutingFile);
  if (!existsSync(examplePath)) {
    return {
      ok: false,
      output: outputPath,
      issue: `Domestic release env example is missing: ${examplePath}`,
    };
  }
  if (existsSync(outputPath) && !options.overwrite) {
    return {
      ok: false,
      output: outputPath,
      issue: "Domestic release env already exists. Pass --overwrite to replace it.",
    };
  }

  const template = readFileSync(examplePath, "utf8");
  const env = parseEnvFile(template);
  const appliedSources = [];

  if (existsSync(liveKitSnippetPath)) {
    Object.assign(env, parseEnvFile(readFileSync(liveKitSnippetPath, "utf8")));
    appliedSources.push(options.liveKitSnippet);
  }

  let modelRoutingReference = [];
  if (existsSync(modelRoutingPath)) {
    const rendered = renderModelRoutingEnv(
      modelRoutingPath,
      options.modelRoutingProfile,
    );
    env.MODEL_ROUTING_FILE = options.modelRoutingFile;
    env.MODEL_ROUTING_PROFILE = rendered.profile;
    applyModelSelectionEnv(env, modelRoutingPath, rendered.profile);
    modelRoutingReference = rendered.lines;
    appliedSources.push(`${options.modelRoutingFile}:${rendered.profile}`);
  }

  const text = renderEnvDraft(template, env, modelRoutingReference);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, text);
  return {
    ok: true,
    output: outputPath,
    example: examplePath,
    appliedSources,
    remainingPlaceholderKeys: placeholderKeys(env),
  };
}

function applyModelSelectionEnv(env, modelRoutingPath, profileName) {
  const config = JSON.parse(readFileSync(modelRoutingPath, "utf8"));
  const profile = config.profiles?.[profileName];
  if (!profile) return;
  if (profile.translation?.provider) {
    env.REALTIME_PROVIDER = profile.translation.provider;
    env.TRANSLATION_PROVIDER = profile.translation.provider;
  }
  if (profile.translation?.model) {
    env.TRANSLATION_MODEL = profile.translation.model;
  }
  if (profile.tts?.provider) env.TTS_PROVIDER = profile.tts.provider;
  if (profile.tts?.model) env.TTS_MODEL = profile.tts.model;
}

function renderEnvDraft(template, env, modelRoutingReference) {
  const seen = new Set();
  const lines = template.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (!match) return line;
    const key = match[1];
    seen.add(key);
    return `${key}=${formatEnvValue(env[key] ?? "")}`;
  });
  const extraLines = Object.keys(env)
    .filter((key) => !seen.has(key))
    .sort()
    .map((key) => `${key}=${formatEnvValue(env[key])}`);
  if (extraLines.length > 0) {
    lines.push("", "# Extra values merged from deployment snippets.", ...extraLines);
  }
  if (modelRoutingReference.length > 0) {
    lines.push(
      "",
      "# Model routing reference. These are local runtime hints; review URLs",
      "# before copying them into a production env.",
      ...modelRoutingReference.map((line) => `# ${line}`),
    );
  }
  return `${lines.join("\n").replace(/\n+$/g, "")}\n`;
}

function placeholderKeys(env) {
  return Object.entries(env)
    .filter(([, value]) => isPlaceholder(String(value)))
    .map(([key]) => key)
    .sort();
}

function isPlaceholder(value) {
  return /required|replace|example|your-|todo|待填|translation\.local|localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(
    value,
  );
}

function formatEnvValue(value) {
  const text = String(value ?? "");
  return /\s|#/.test(text) ? `'${text.replace(/'/g, "'\"'\"'")}'` : text;
}

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
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  args.splice(index, 2);
  return value;
}

function usage() {
  console.log(`Usage:
  scripts/scaffold_domestic_release_env.mjs [--json]
  scripts/scaffold_domestic_release_env.mjs --overwrite
  scripts/scaffold_domestic_release_env.mjs --output release/domestic/release.env.todo
  scripts/scaffold_domestic_release_env.mjs --model-routing-profile domestic_server_qwen3_hymt2_voxcpm2

Creates a private domestic release env draft from release.env.example, merges
self-hosted LiveKit values when infra/livekit-selfhost/generated/release.env.snippet
exists, and records the selected model-routing profile. The generated file still
contains placeholders for real payment, model-service, diagnostics, and PSTN
credentials, so release-ready cannot be accidentally passed.`);
}
