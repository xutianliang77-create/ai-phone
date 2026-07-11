import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type {
  ModelProviderChoiceDto,
  ModelRoutingProfileDto,
  ModelRoutingResponse,
} from "@translation/contracts";

const defaultModelRoutingFile = "release/domestic/model-routing.json";

interface ModelRoutingFile {
  schemaVersion?: number;
  activeProfile?: string;
  profiles?: Record<string, ModelRoutingProfileFile>;
}

interface ModelRoutingProfileFile {
  description?: string;
  asr?: Partial<ModelProviderChoiceDto>;
  translation?: Partial<ModelProviderChoiceDto>;
  tts?: Partial<ModelProviderChoiceDto>;
}

export function getModelRoutingStatus(): ModelRoutingResponse {
  const configuredFile = process.env.MODEL_ROUTING_FILE ?? defaultModelRoutingFile;
  const sourceFile = resolveModelRoutingFile(configuredFile);
  if (!existsSync(sourceFile)) {
    return notReady(sourceFile, [`model routing file not found: ${configuredFile}`]);
  }

  let parsed: ModelRoutingFile;
  try {
    parsed = JSON.parse(readFileSync(sourceFile, "utf8")) as ModelRoutingFile;
  } catch (error) {
    return notReady(sourceFile, [`model routing file is invalid JSON: ${errorMessage(error)}`]);
  }

  const activeProfile = process.env.MODEL_ROUTING_PROFILE ?? parsed.activeProfile;
  const issues = validateModelRouting(parsed, activeProfile);
  const profiles = Object.entries(parsed.profiles ?? {})
    .map(([name, profile]) => toProfileDto(name, profile))
    .filter((profile): profile is ModelRoutingProfileDto => profile !== null);
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    activeProfile,
    sourceFile,
    profiles,
    issues,
  };
}

function validateModelRouting(
  parsed: ModelRoutingFile,
  activeProfile: string | undefined,
) {
  const issues: string[] = [];
  if (parsed.schemaVersion !== 1) {
    issues.push("model routing schemaVersion must be 1");
  }
  if (!parsed.profiles || Object.keys(parsed.profiles).length === 0) {
    issues.push("model routing profiles are required");
  }
  if (!activeProfile || !parsed.profiles?.[activeProfile]) {
    issues.push("model routing activeProfile must exist");
  }
  return issues;
}

function toProfileDto(
  name: string,
  profile: ModelRoutingProfileFile,
): ModelRoutingProfileDto | null {
  const asr = choice(profile.asr);
  const translation = choice(profile.translation);
  const tts = choice(profile.tts);
  if (!asr || !translation || !tts) return null;
  return {
    name,
    description: profile.description,
    asr,
    translation,
    tts,
  };
}

function choice(
  value: Partial<ModelProviderChoiceDto> | undefined,
): ModelProviderChoiceDto | null {
  if (!value?.provider || !value.model || !value.contract) return null;
  return {
    provider: value.provider,
    model: value.model,
    contract: value.contract,
  };
}

function notReady(sourceFile: string, issues: string[]): ModelRoutingResponse {
  return {
    status: "not_ready",
    sourceFile,
    profiles: [],
    issues,
  };
}

function resolveModelRoutingFile(filePath: string) {
  if (isAbsolute(filePath)) return filePath;
  let cursor = process.cwd();
  for (;;) {
    const candidate = resolve(cursor, filePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) return resolve(process.cwd(), filePath);
    cursor = parent;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
