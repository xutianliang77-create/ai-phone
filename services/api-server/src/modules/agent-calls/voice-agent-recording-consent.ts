import type { AuthorizeAiCallingAgentRequest } from "@translation/contracts";

export interface VoiceAgentRecordingConsentConfig {
  policyVersion: string;
  promptTextZh: string;
  promptTextEn: string;
  ttlSeconds: number;
}

export function getVoiceAgentRecordingConsentConfig():
  | { ok: true; config: VoiceAgentRecordingConsentConfig }
  | { ok: false; status: "disabled" | "not_ready"; issues: string[] } {
  if (process.env.VOICE_AGENT_RECORDING_ENABLED !== "true") {
    return {
      ok: false,
      status: "disabled",
      issues: ["Voice Agent recording consent is disabled"],
    };
  }
  const policyVersion = process.env.VOICE_AGENT_RECORDING_POLICY_VERSION?.trim() ?? "";
  const promptTextZh = process.env.VOICE_AGENT_RECORDING_CONSENT_TEXT_ZH?.trim() ?? "";
  const promptTextEn = process.env.VOICE_AGENT_RECORDING_CONSENT_TEXT_EN?.trim() ?? "";
  const ttlSeconds = integer(process.env.VOICE_AGENT_RECORDING_CONSENT_TTL_SECONDS, 7200);
  const issues = [
    ...(!validPolicy(policyVersion)
      ? ["VOICE_AGENT_RECORDING_POLICY_VERSION is invalid"]
      : []),
    ...(!bounded(promptTextZh, 20, 500)
      ? ["VOICE_AGENT_RECORDING_CONSENT_TEXT_ZH is required"]
      : []),
    ...(!bounded(promptTextEn, 20, 500)
      ? ["VOICE_AGENT_RECORDING_CONSENT_TEXT_EN is required"]
      : []),
    ...(!ttlSeconds
      ? ["VOICE_AGENT_RECORDING_CONSENT_TTL_SECONDS must be 300-14400"]
      : []),
  ];
  return issues.length > 0
    ? { ok: false, status: "not_ready", issues }
    : {
        ok: true,
        config: { policyVersion, promptTextZh, promptTextEn, ttlSeconds: ttlSeconds! },
      };
}

export function validateVoiceAgentRecordingAuthorization(
  request: AuthorizeAiCallingAgentRequest,
) {
  if (request.recordingRequested !== true) {
    return request.recordingPolicyVersion === undefined
      ? { ok: true as const, requested: false as const }
      : { ok: false as const, code: "recording_policy_without_request" };
  }
  const configured = getVoiceAgentRecordingConsentConfig();
  if (!configured.ok) {
    return { ok: false as const, code: "recording_not_ready", configured };
  }
  if (request.recordingPolicyVersion !== configured.config.policyVersion) {
    return { ok: false as const, code: "recording_policy_mismatch" };
  }
  return { ok: true as const, requested: true as const, config: configured.config };
}

export function voiceAgentRecordingConsentSnapshot(input: {
  language: "zh" | "en";
  callExpiresAt: string;
  now?: Date;
}) {
  const configured = getVoiceAgentRecordingConsentConfig();
  if (!configured.ok) return null;
  const now = input.now ?? new Date();
  const expiresAt = new Date(Math.min(
    Date.parse(input.callExpiresAt),
    now.getTime() + configured.config.ttlSeconds * 1000,
  )).toISOString();
  return {
    policyVersion: configured.config.policyVersion,
    promptText: input.language === "en"
      ? configured.config.promptTextEn
      : configured.config.promptTextZh,
    expiresAt,
  };
}

function validPolicy(value: string) {
  return bounded(value, 1, 80) && /^[A-Za-z0-9._-]+$/.test(value);
}

function bounded(value: string, minimum: number, maximum: number) {
  const bytes = Buffer.byteLength(value);
  return bytes >= minimum && bytes <= maximum;
}

function integer(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= 300 && parsed <= 14_400
    ? parsed
    : null;
}
