import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

interface ModelRoutingConfig {
  activeProfile?: string;
  profiles?: Record<string, ModelRoutingProfile>;
}

interface ModelRoutingProfile {
  env?: Record<string, Record<string, unknown>>;
  asr?: ModelRoutingIdentity;
  translation?: ModelRoutingIdentity;
  tts?: ModelRoutingIdentity;
}

interface ModelRoutingIdentity {
  provider?: string;
  model?: string;
}

export interface ModelRoutingProfileMetadata {
  name: string;
  asr?: ModelRoutingIdentity;
  translation?: ModelRoutingIdentity;
  tts?: ModelRoutingIdentity;
}

const DEFAULT_MODEL_ROUTING_FILE = "release/domestic/model-routing.json";

export function mergeModelRoutingEnv(
  groupName: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  return {
    ...loadModelRoutingEnvGroup(groupName, env),
    ...env,
  };
}

export function loadModelRoutingEnvGroup(
  groupName: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!env.MODEL_ROUTING_FILE && !env.MODEL_ROUTING_PROFILE) return {};

  const filePath = resolveModelRoutingFile(
    env.MODEL_ROUTING_FILE ?? DEFAULT_MODEL_ROUTING_FILE,
  );
  const config = JSON.parse(readFileSync(filePath, "utf8")) as ModelRoutingConfig;
  const profileName = env.MODEL_ROUTING_PROFILE ?? config.activeProfile;
  const profile = profileName ? config.profiles?.[profileName] : undefined;
  if (!profile) throw new Error(`Model routing profile not found: ${profileName ?? ""}`);

  return stringEnvRecord(profile.env?.[groupName] ?? {});
}

export function loadModelRoutingProfileMetadata(
  env: NodeJS.ProcessEnv = process.env,
): ModelRoutingProfileMetadata | undefined {
  if (!env.MODEL_ROUTING_FILE && !env.MODEL_ROUTING_PROFILE) return undefined;
  const filePath = resolveModelRoutingFile(
    env.MODEL_ROUTING_FILE ?? DEFAULT_MODEL_ROUTING_FILE,
  );
  const config = JSON.parse(readFileSync(filePath, "utf8")) as ModelRoutingConfig;
  const name = env.MODEL_ROUTING_PROFILE ?? config.activeProfile;
  const profile = name ? config.profiles?.[name] : undefined;
  if (!name || !profile) throw new Error(`Model routing profile not found: ${name ?? ""}`);
  return {
    name,
    ...(profile.asr ? { asr: { ...profile.asr } } : {}),
    ...(profile.translation
      ? { translation: { ...profile.translation } } : {}),
    ...(profile.tts ? { tts: { ...profile.tts } } : {}),
  };
}

function resolveModelRoutingFile(filePath: string) {
  if (path.isAbsolute(filePath)) {
    if (existsSync(filePath)) return filePath;
    throw new Error(`Model routing file not found: ${filePath}`);
  }

  let current = process.cwd();
  for (let index = 0; index < 6; index += 1) {
    const candidate = path.resolve(current, filePath);
    if (existsSync(candidate)) return candidate;
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }

  throw new Error(`Model routing file not found: ${filePath}`);
}

function stringEnvRecord(input: Record<string, unknown>) {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Model routing env ${key} must be a non-empty string`);
    }
    result[key] = value;
  }
  return result;
}
