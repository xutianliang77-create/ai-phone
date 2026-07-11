const redacted = "[REDACTED]";

const sensitiveKeys = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "audio",
  "content",
  "data",
  "email",
  "password",
  "phone",
  "phonenumber",
  "refreshtoken",
  "secret",
  "signedpayload",
  "signedtransactioninfo",
  "sourcetext",
  "targetphone",
  "text",
  "token",
  "transcript",
  "translatedtext",
  "translation",
  "webhooksecret",
]);

export const logRedactionPaths = [
  "req.headers.authorization",
  "*.accessToken",
  "*.apiKey",
  "*.authorization",
  "*.content",
  "*.data",
  "*.password",
  "*.refreshToken",
  "*.secret",
  "*.signedPayload",
  "*.signedTransactionInfo",
  "*.sourceText",
  "*.targetPhone",
  "*.text",
  "*.token",
  "*.transcript",
  "*.translatedText",
  "*.translation",
  "*.webhookSecret",
];

export function redactLogObject<T>(value: T): T {
  return redactValue(value) as T;
}

export function redactLogString(value: string): string {
  return redactInlineSensitiveText(value);
}

function redactValue(value: unknown, key?: string): unknown {
  if (key && sensitiveKeys.has(normalizeKey(key))) return redacted;
  if (typeof value === "string") return redactInlineSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (!value || typeof value !== "object") return value;
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactValue(entryValue, entryKey),
    ]),
  );
}

function redactInlineSensitiveText(value: string) {
  return value
    .replace(sensitiveInlinePattern(), (_match, key) => `${key}=${redacted}`)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, redacted)
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, redacted)
    .replace(/(?<![\w+])\+\d[\d\s().-]{7,}\d(?!\w)/g, redacted)
    .replace(/(?<!\d)(?:\(\d{3}\)|\d{3})[-\s.]\d{3}[-\s.]\d{4}(?!\d)/g, redacted);
}

function sensitiveInlinePattern() {
  return new RegExp(
    `\\b(${Array.from(sensitiveKeys).join("|")})\\s*[:=]\\s*("[^"]*"|'[^']*'|[^,\\s&}]+)`,
    "gi",
  );
}

function normalizeKey(key: string) {
  return key.replace(/[_-]/g, "").toLowerCase();
}

function isPlainObject(value: object) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
