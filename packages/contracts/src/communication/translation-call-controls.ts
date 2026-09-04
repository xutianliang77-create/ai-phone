export const translationCallControlTopic = "translation.call-control.v1";

interface TranslationCallControlBinding {
  version: 1;
  callId: string;
  dialOperationId: string;
  controlOperationId: string;
  dispatchGeneration: number;
  controlGeneration: number;
  issuedAt: string;
  expiresAt: string;
}

export interface TranslationTypeToSpeakCommand extends
TranslationCallControlBinding {
  type: "translation.type_to_speak";
  text: string;
  sourceLanguage: "zh" | "en";
  targetLanguage: "zh" | "en";
}

export interface TranslationUplinkControlCommand extends
TranslationCallControlBinding {
  type: "translation.uplink_pause";
  paused: boolean;
}

export type TranslationCallControlCommand =
  | TranslationTypeToSpeakCommand
  | TranslationUplinkControlCommand;

export interface TranslationCallControlStatus {
  dialOperationId: string;
  dispatchGeneration: number;
  controlGeneration: number;
  status: "prepared" | "succeeded" | "failed";
  errorClass?: string;
}

export function encodeTranslationCallControl(
  command: TranslationCallControlCommand,
) {
  return new TextEncoder().encode(JSON.stringify(command));
}

export function parseTranslationCallControl(
  payload: Uint8Array,
): TranslationCallControlCommand | null {
  if (payload.byteLength < 2 || payload.byteLength > 4096) return null;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(payload)) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      return null;
    }
    const value = decoded as Record<string, unknown>;
    if (!validBinding(value)) return null;
    if (value.type === "translation.uplink_pause") {
      return typeof value.paused === "boolean"
        ? value as unknown as TranslationUplinkControlCommand
        : null;
    }
    if (value.type !== "translation.type_to_speak" ||
      !validText(value.text, 800) ||
      !isP0Language(value.sourceLanguage) ||
      !isP0Language(value.targetLanguage) ||
      value.sourceLanguage === value.targetLanguage) return null;
    return {
      ...value,
      text: value.text.trim(),
    } as unknown as TranslationTypeToSpeakCommand;
  } catch {
    return null;
  }
}

function validBinding(value: Record<string, unknown>) {
  const issuedAt = timestamp(value.issuedAt);
  const expiresAt = timestamp(value.expiresAt);
  return value.version === 1 &&
    (value.type === "translation.type_to_speak" ||
      value.type === "translation.uplink_pause") &&
    identifier(value.callId, 128) &&
    identifier(value.dialOperationId, 160) &&
    identifier(value.controlOperationId, 160) &&
    positiveInteger(value.dispatchGeneration) &&
    positiveInteger(value.controlGeneration) &&
    issuedAt !== null && expiresAt !== null && expiresAt > issuedAt &&
    expiresAt - issuedAt <= 120_000;
}

function identifier(value: unknown, maximum: number) {
  return typeof value === "string" && value.length > 0 &&
    value.length <= maximum && /^[A-Za-z0-9:._-]+$/.test(value);
}

function validText(value: unknown, maximumBytes: number): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    new TextEncoder().encode(value.trim()).byteLength <= maximumBytes;
}

function isP0Language(value: unknown): value is "zh" | "en" {
  return value === "zh" || value === "en";
}

function positiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function timestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
