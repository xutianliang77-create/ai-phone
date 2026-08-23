import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const DOMAINS = ["asr", "translation", "tts", "speaker"];
const ALLOW_EMPTY_ENV_KEYS = new Set([
  "ASR_QWEN3_CONTEXT",
  "ASR_QWEN3_ENGLISH_CONTEXT",
]);

export function checkModelRoutingConfig(filePath) {
  const checks = [];
  const issues = [];
  const actions = [];

  if (!filePath || !existsSync(filePath)) {
    record(checks, "model_routing_file_exists", false, { filePath });
    issues.push("Model routing config is required.");
    actions.push("Create release/domestic/model-routing.json.");
    return result(filePath, checks, issues, actions);
  }

  record(checks, "model_routing_file_exists", true, { filePath });
  const config = parseConfig(filePath, checks, issues);
  if (!config) return result(filePath, checks, issues, actions);

  const activeProfile = config.profiles?.[config.activeProfile];
  const activeReady = Boolean(config.activeProfile && activeProfile);
  record(checks, "model_routing_active_profile", activeReady, {
    activeProfile: config.activeProfile ?? null,
  });
  if (!activeReady) issues.push("Model routing activeProfile must exist.");

  for (const [name, profile] of Object.entries(config.profiles ?? {})) {
    checkProfile(name, profile, checks, issues);
  }

  if (activeReady) checkActiveEnv(activeProfile, checks, issues);
  checkWujieRuntimeContract(filePath, config, checks, issues);
  if (issues.length > 0) {
    actions.push("Fix model routing provider/model/env entries and rerun this check.");
  }
  return result(filePath, checks, issues, actions);
}

function checkWujieRuntimeContract(filePath, config, checks, issues) {
  const contractPath = path.join(
    path.dirname(filePath),
    "wujie-v1-runtime-contract.json",
  );
  if (!existsSync(contractPath)) return;
  let expected;
  try {
    expected = JSON.parse(readFileSync(contractPath, "utf8")).modelRouting;
  } catch (error) {
    record(checks, "model_routing_wujie_v1_contract", false, {
      contractPath,
      message: errorMessage(error),
    });
    issues.push("Wujie V1 runtime contract is not valid JSON.");
    return;
  }
  const profile = config.profiles?.[expected?.activeProfile];
  const actual = {
    activeProfile: config.activeProfile,
    asrProvider: profile?.asr?.provider,
    asrModel: profile?.asr?.model,
    translationProvider: profile?.translation?.provider,
    translationModel: profile?.translation?.model,
    ttsProvider: profile?.tts?.provider,
    ttsModel: profile?.tts?.model,
    speakerProvider: profile?.speaker?.provider,
    speakerModel: profile?.speaker?.model,
  };
  const mismatches = Object.entries(expected ?? {})
    .filter(([key, value]) => actual[key] !== value)
    .map(([key, value]) => ({ key, expected: value, actual: actual[key] }));
  const ready = Boolean(expected?.activeProfile && profile) && mismatches.length === 0;
  record(checks, "model_routing_wujie_v1_contract", ready, {
    contractPath,
    mismatches,
  });
  if (!ready) {
    issues.push("Active model routing does not match the Wujie V1 runtime contract.");
  }
}

export function appendModelRoutingReadiness(context) {
  if (!context.enabled) {
    context.record(context.checks, "model_routing_readiness", true, { skipped: true });
    return;
  }
  const result = (context.checkFn ?? checkModelRoutingConfig)(context.filePath);
  const ready = result.status === "ready";
  context.record(context.checks, "model_routing_readiness", ready, {
    status: result.status,
    filePath: result.filePath,
    checks: result.checks,
  });
  if (!ready) {
    context.issues.push("model_routing_readiness is not ready.");
    context.issues.push(...normalizeIssues(result.issues));
    context.actions.push(...(result.actions ?? []));
  }
}

export function renderModelRoutingEnv(filePath, profileName, groupName) {
  const config = JSON.parse(readFileSync(filePath, "utf8"));
  const selected = profileName ?? config.activeProfile;
  const profile = config.profiles?.[selected];
  if (!profile) throw new Error(`Model routing profile not found: ${selected}`);
  const groups = selectEnvGroups(profile.env ?? {}, groupName);
  return {
    profile: selected,
    group: groupName ?? null,
    groups,
    lines: envLines(groups),
  };
}

function parseConfig(filePath, checks, issues) {
  try {
    const config = JSON.parse(readFileSync(filePath, "utf8"));
    const ready = config.schemaVersion === 1 && isObject(config.profiles);
    record(checks, "model_routing_schema", ready, {
      schemaVersion: config.schemaVersion ?? null,
    });
    if (!ready) issues.push("Model routing config must use schemaVersion=1 and profiles.");
    return ready ? config : null;
  } catch (error) {
    record(checks, "model_routing_json", false, { message: errorMessage(error) });
    issues.push(`Model routing config is not valid JSON: ${errorMessage(error)}`);
    return null;
  }
}

function checkProfile(name, profile, checks, issues) {
  const domainReady = DOMAINS.every((domain) => hasChoice(profile?.[domain]));
  record(checks, `model_routing_profile:${name}`, domainReady, {
    asr: summarizeChoice(profile?.asr),
    translation: summarizeChoice(profile?.translation),
    tts: summarizeChoice(profile?.tts),
    speaker: summarizeChoice(profile?.speaker),
  });
  if (!domainReady) {
    issues.push(
      `Model routing profile ${name} must include ASR, translation, TTS, and speaker choices.`,
    );
  }
  checkEnvGroups(name, profile?.env ?? {}, checks, issues);
}

function checkEnvGroups(profileName, groups, checks, issues) {
  for (const [groupName, env] of Object.entries(groups)) {
    const entries = Object.entries(env ?? {});
    const ready = entries.length > 0 && entries.every(([key, value]) =>
      /^[A-Z][A-Z0-9_]*$/.test(key) &&
      typeof value === "string" &&
      (value.length > 0 || ALLOW_EMPTY_ENV_KEYS.has(key))
    );
    record(checks, `model_routing_env:${profileName}:${groupName}`, ready, {
      keys: entries.map(([key]) => key),
    });
    if (!ready) issues.push(`Model routing env group ${profileName}/${groupName} is invalid.`);
  }
}

function checkActiveEnv(profile, checks, issues) {
  const groups = profile.env ?? {};
  const ready = Boolean(groups.gateway || groups.mobile || groups.translationWorker);
  record(checks, "model_routing_active_runtime_env", ready, {
    groups: Object.keys(groups),
  });
  if (!ready) {
    issues.push("Active model routing profile must include gateway, mobile, or worker env.");
  }
}

function selectEnvGroups(groups, groupName) {
  if (!groupName) return groups;
  if (!groups[groupName]) {
    throw new Error(`Model routing env group not found: ${groupName}`);
  }
  return { [groupName]: groups[groupName] };
}

function envLines(groups) {
  const lines = [];
  for (const [groupName, env] of Object.entries(groups)) {
    lines.push(`# ${groupName}`);
    for (const [key, value] of Object.entries(env)) {
      lines.push(`export ${key}=${shellQuote(value)}`);
    }
  }
  return lines;
}

function hasChoice(value) {
  return Boolean(value?.provider && value?.model && value?.contract);
}

function summarizeChoice(value = {}) {
  return value.provider && value.model ? `${value.provider}/${value.model}` : null;
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\"'\"'")}'`;
}

function result(filePath, checks, issues, actions) {
  return {
    schemaVersion: 1,
    status: issues.length === 0 ? "ready" : "not_ready",
    filePath: filePath || null,
    checks,
    issues,
    actions: [...new Set(actions)],
  };
}

function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}

function normalizeIssues(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.length > 0)
    : [];
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
