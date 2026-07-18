import { createHash } from "node:crypto";
import type { EnterpriseTerminologyPurpose } from "@translation/contracts";
import {
  validateEnterpriseTermDimensions,
} from "./enterprise-terminology.js";

export interface EnterpriseScriptTemplateContent {
  promptText: string;
  requiredPhrases: string[];
  prohibitedPhrases: string[];
  variables: string[];
}

export function validateEnterpriseScriptDimensions(input: {
  locale: string;
  countryCode: string;
  productCode: string;
}) {
  const dimensions = validateEnterpriseTermDimensions({
    sourceLocale: input.locale,
    targetLocale: input.locale,
    countryCode: input.countryCode,
    productCode: input.productCode,
    usageScope: "all",
  });
  return {
    locale: dimensions.sourceLocale,
    countryCode: dimensions.countryCode,
    productCode: dimensions.productCode,
  };
}

export function validateEnterpriseScriptPurpose(
  value: unknown,
): EnterpriseTerminologyPurpose {
  if (value !== "all" && value !== "marketing" &&
    value !== "support" && value !== "meeting") {
    throw new Error("Invalid enterprise script purpose");
  }
  return value;
}

export function prepareEnterpriseScriptContent(
  input: EnterpriseScriptTemplateContent,
) {
  const promptText = bounded(input.promptText, 20_000, "script prompt");
  const requiredPhrases = phrases(input.requiredPhrases, "required phrase");
  const prohibitedPhrases = phrases(input.prohibitedPhrases, "prohibited phrase");
  const requiredKeys = new Set(requiredPhrases.map(normalized));
  if (prohibitedPhrases.some((value) => requiredKeys.has(normalized(value)))) {
    throw new Error("Enterprise script phrase cannot be both required and prohibited");
  }
  if (!Array.isArray(input.variables) || input.variables.length > 50) {
    throw new Error("Invalid enterprise script variables");
  }
  const variables = input.variables.map((value) => {
    if (typeof value !== "string" || !/^[a-z][A-Za-z0-9_]{0,63}$/.test(value)) {
      throw new Error("Invalid enterprise script variable");
    }
    return value;
  });
  if (new Set(variables).size !== variables.length) {
    throw new Error("Duplicate enterprise script variable");
  }
  const content = { promptText, requiredPhrases, prohibitedPhrases, variables };
  const serialized = JSON.stringify(content);
  if (Buffer.byteLength(serialized) > 64_000) {
    throw new Error("Enterprise script template is too large");
  }
  return {
    ...content,
    contentHash: createHash("sha256").update(serialized).digest("hex"),
  };
}

function phrases(values: string[], field: string) {
  if (!Array.isArray(values) || values.length > 50) {
    throw new Error(`Invalid enterprise ${field}`);
  }
  const result = values.map((value) => bounded(value, 500, field));
  if (new Set(result.map(normalized)).size !== result.length) {
    throw new Error(`Duplicate enterprise ${field}`);
  }
  return result;
}

function bounded(value: string, maxBytes: number, field: string) {
  if (typeof value !== "string") throw new Error(`Invalid enterprise ${field}`);
  const result = value.trim();
  if (!result || Buffer.byteLength(result) > maxBytes) {
    throw new Error(`Invalid enterprise ${field}`);
  }
  return result;
}

function normalized(value: string) {
  return value.toLocaleLowerCase();
}
