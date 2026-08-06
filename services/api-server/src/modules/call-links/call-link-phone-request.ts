import {
  isTranslationLanguage,
  type CreatePhoneOutboundCallRequest,
} from "@translation/contracts";

export function parsePhoneOutboundRequest(
  body: unknown,
): CreatePhoneOutboundCallRequest | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const targetPhone = typeof value.targetPhone === "string"
    ? value.targetPhone.trim()
    : "";
  const sourceLanguage = typeof value.sourceLanguage === "string"
    ? value.sourceLanguage
    : "";
  const targetLanguage = typeof value.targetLanguage === "string"
    ? value.targetLanguage
    : "";
  const initialDtmf = typeof value.initialDtmf === "string"
    ? value.initialDtmf.trim()
    : undefined;
  if (!/^\+[1-9]\d{7,14}$/.test(targetPhone) ||
    !isTranslationLanguage(sourceLanguage) ||
    !isTranslationLanguage(targetLanguage) ||
    !["zh", "en"].includes(sourceLanguage) ||
    !["zh", "en"].includes(targetLanguage) ||
    sourceLanguage === targetLanguage || value.disclosureConfirmed !== true ||
    (initialDtmf !== undefined && !/^[0-9*#A-Dw]{1,64}$/.test(initialDtmf))) {
    return null;
  }
  return {
    targetPhone,
    sourceLanguage,
    targetLanguage,
    disclosureConfirmed: true,
    ...(initialDtmf ? { initialDtmf } : {}),
  };
}
