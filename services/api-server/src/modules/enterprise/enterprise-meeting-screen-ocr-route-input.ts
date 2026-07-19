import { createHash } from "node:crypto";
import type {
  EnterpriseMeetingScreenOcrDisplayMode,
  EnterpriseMeetingScreenOcrLanguage,
} from "@translation/contracts";

export function parseScreenOcrEnable(value: unknown) {
  const body = record(value);
  if (!body || !exact(body, ["shareId", "expectedShareVersion",
    "targetLanguage", "displayMode"]) || !uuid(body.shareId) ||
    !positive(body.expectedShareVersion) || !language(body.targetLanguage) ||
    !mode(body.displayMode)) return null;
  return {
    shareId: body.shareId,
    expectedShareVersion: body.expectedShareVersion,
    targetLanguage: body.targetLanguage,
    displayMode: body.displayMode,
  };
}

export function parseScreenOcrDisable(value: unknown) {
  const body = record(value);
  return body && exact(body, ["expectedVersion"]) && positive(body.expectedVersion)
    ? { expectedVersion: body.expectedVersion } : null;
}

export function parseScreenOcrClaim(value: unknown) {
  const body = workerBody(value, ["frameId", "perceptualHash", "sourceWidth",
    "sourceHeight", "capturedAt"]);
  if (!body || !uuid(body.frameId) ||
    typeof body.perceptualHash !== "string" ||
    !/^[a-f0-9]{16}$/.test(body.perceptualHash) ||
    !integer(body.sourceWidth, 16, 7680) || !integer(body.sourceHeight, 16, 4320) ||
    !timestamp(body.capturedAt)) return null;
  return { ticket: body.ticket, frameId: body.frameId,
    perceptualHash: body.perceptualHash, sourceWidth: body.sourceWidth,
    sourceHeight: body.sourceHeight,
    capturedAt: new Date(body.capturedAt).toISOString() };
}

export function parseScreenOcrComplete(value: unknown) {
  const body = workerBody(value, ["frameId", "providerFingerprint", "blocks"]);
  if (!body || !uuid(body.frameId) || !fingerprint(body.providerFingerprint) ||
    !Array.isArray(body.blocks) || body.blocks.length > 100) return null;
  const blocks = body.blocks.map(block);
  if (blocks.some((item) => !item) ||
    Buffer.byteLength(JSON.stringify(blocks)) > 9_000) return null;
  return { ticket: body.ticket, frameId: body.frameId,
    providerFingerprint: body.providerFingerprint,
    blocks: blocks as NonNullable<ReturnType<typeof block>>[] };
}

export function parseScreenOcrFail(value: unknown) {
  const body = workerBody(value, ["frameId", "reasonCode"],
    ["providerFingerprint"]);
  if (!body || !uuid(body.frameId) || !reason(body.reasonCode) ||
    (body.providerFingerprint !== undefined &&
      !fingerprint(body.providerFingerprint))) return null;
  return { ticket: body.ticket, frameId: body.frameId,
    reasonCode: body.reasonCode,
    ...(body.providerFingerprint
      ? { providerFingerprint: body.providerFingerprint } : {}) };
}

export function parseScreenOcrRunFail(value: unknown) {
  const body = workerBody(value, ["reasonCode"]);
  return body && reason(body.reasonCode)
    ? { ticket: body.ticket, reasonCode: body.reasonCode } : null;
}

export function parseScreenOcrTicketBody(value: unknown) {
  const body = workerBody(value, []);
  return body ? { ticket: body.ticket } : null;
}

export function screenOcrRequestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function block(value: unknown) {
  const item = record(value);
  const rect = record(item?.rect);
  if (!item || !exact(item, ["rect", "sourceLanguage", "sourceText",
    "translatedText"]) || !rect || !exact(rect, ["left", "top", "width",
    "height"]) || !language(item.sourceLanguage) ||
    !bounded(item.sourceText, 4_000) || !bounded(item.translatedText, 4_000)) {
    return null;
  }
  const values = [rect.left, rect.top, rect.width, rect.height];
  if (!values.every((entry) => typeof entry === "number" && Number.isFinite(entry)) ||
    Number(rect.left) < 0 || Number(rect.top) < 0 || Number(rect.width) <= 0 ||
    Number(rect.height) <= 0 || Number(rect.left) + Number(rect.width) > 1.000001 ||
    Number(rect.top) + Number(rect.height) > 1.000001) return null;
  return { rect: { left: Number(rect.left), top: Number(rect.top),
    width: Number(rect.width), height: Number(rect.height) },
    sourceLanguage: item.sourceLanguage,
    sourceText: item.sourceText.trim(), translatedText: item.translatedText.trim() };
}

function workerBody(value: unknown, required: string[], optional: string[] = []) {
  const body = record(value);
  const keys = ["ticket", ...required];
  if (!body || !keys.every((key) => key in body) ||
    Object.keys(body).some((key) => !keys.includes(key) && !optional.includes(key)) ||
    !bounded(body.ticket, 4_096, 64)) return null;
  return body as Record<string, unknown> & { ticket: string };
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key));
}
function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}
function positive(value: unknown): value is number {
  return integer(value, 1, Number.MAX_SAFE_INTEGER);
}
function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= minimum && value <= maximum;
}
function language(value: unknown): value is EnterpriseMeetingScreenOcrLanguage {
  return value === "zh" || value === "en";
}
function mode(value: unknown): value is EnterpriseMeetingScreenOcrDisplayMode {
  return value === "original" || value === "translated" || value === "bilingual";
}
function bounded(value: unknown, maximum: number, minimum = 1): value is string {
  return typeof value === "string" && Buffer.byteLength(value.trim()) >= minimum &&
    Buffer.byteLength(value.trim()) <= maximum;
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function fingerprint(value: unknown): value is string {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
}
function reason(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9._:-]{0,159}$/.test(value);
}
