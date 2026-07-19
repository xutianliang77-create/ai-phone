import { createHash } from "node:crypto";
import {
  getCountries,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import type {
  EnterpriseLeadAttributeValue,
  EnterpriseLeadImportErrorDto,
  EnterpriseLeadImportRequest,
  EnterpriseLeadImportRowInput,
  EnterpriseLeadImportSourceKind,
} from "@translation/contracts";

const supportedCountries = new Set<string>(getCountries());
const maximumRows = 500;
const maximumCsvBytes = 512 * 1_024;

export interface NormalizedEnterpriseLeadImportRow {
  rowNumber: number;
  externalId?: string;
  phoneInput: string;
  phoneE164: string;
  phoneHint: string;
  countryCode: string;
  timezone?: string;
  language?: string;
  attributes: Record<string, EnterpriseLeadAttributeValue>;
}

export type NormalizedEnterpriseLeadImport =
  | { status: "ready"; sourceKind: EnterpriseLeadImportSourceKind;
      sourceReference: string; rows: NormalizedEnterpriseLeadImportRow[] }
  | { status: "rejected"; totalRows: number;
      errors: EnterpriseLeadImportErrorDto[] };

export function normalizeEnterpriseLeadImport(
  input: EnterpriseLeadImportRequest,
): NormalizedEnterpriseLeadImport {
  const sourceReference = bounded(input.sourceReference, 200);
  if (!sourceReference) return rejected(0, error(0, "sourceReference", "invalid"));
  const parsed = input.sourceKind === "csv" ? csvRows(input.csv) : apiRows(input.rows);
  if (parsed.status === "rejected") return parsed;
  const errors: EnterpriseLeadImportErrorDto[] = [];
  const rows: NormalizedEnterpriseLeadImportRow[] = [];
  for (const row of parsed.rows) {
    const normalized = normalizeRow(row.value, row.rowNumber);
    if ("error" in normalized) errors.push(...normalized.error);
    else rows.push(normalized.row);
  }
  return errors.length > 0
    ? { status: "rejected", totalRows: parsed.rows.length, errors: errors.slice(0, 500) }
    : { status: "ready", sourceKind: input.sourceKind, sourceReference, rows };
}

export function enterpriseLeadImportRequestHash(input: {
  actorUserId: string;
  campaignId: string;
  sourceKind: EnterpriseLeadImportSourceKind;
  sourceReference: string;
  rows: NormalizedEnterpriseLeadImportRow[];
}) {
  const rows = input.rows.map(({ phoneInput: _phoneInput, ...row }) => row);
  return createHash("sha256").update(stableJson({ ...input, rows })).digest("hex");
}

export function enterpriseLeadImportRollbackRequestHash(input: {
  actorUserId: string;
  campaignId: string;
  batchId: string;
  expectedVersion: number;
}) {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

function apiRows(value: EnterpriseLeadImportRowInput[]) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumRows) {
    return rejected(Array.isArray(value) ? value.length : 0,
      error(0, "rows", "row_count_invalid"));
  }
  return { status: "ready" as const,
    rows: value.map((row, index) => ({ rowNumber: index + 1, value: row })) };
}

function csvRows(csv: string): ReturnType<typeof apiRows> {
  if (typeof csv !== "string" || Buffer.byteLength(csv) > maximumCsvBytes) {
    return rejected(0, error(0, "csv", "csv_size_invalid"));
  }
  const table = parseCsv(csv);
  if (!table || table.length < 2) {
    return rejected(Math.max(0, table?.length ?? 0), error(0, "csv", "csv_invalid"));
  }
  const headers = table[0]!.map((value, index) => index === 0
    ? value.replace(/^\uFEFF/, "") : value);
  const required = ["phone", "countryCode"];
  const standard = new Set(["externalId", ...required, "timezone", "language"]);
  if (new Set(headers).size !== headers.length || required.some((key) =>
    !headers.includes(key)) || headers.some((key) => !standard.has(key) &&
      !/^attr\.[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key))) {
    return rejected(table.length - 1, error(1, "headers", "csv_headers_invalid"));
  }
  const records = table.slice(1).filter((row) => row.some((value) => value !== ""));
  if (records.length < 1 || records.length > maximumRows || records.some((row) =>
    row.length !== headers.length)) {
    return rejected(records.length, error(0, "rows", "row_count_or_width_invalid"));
  }
  return { status: "ready", rows: records.map((record, index) => {
    const values = Object.fromEntries(headers.map((key, position) =>
      [key, record[position] ?? ""]));
    const attributes = Object.fromEntries(headers.filter((key) => key.startsWith("attr."))
      .filter((key) => values[key] !== "").map((key) => [key.slice(5), values[key]!]));
    return { rowNumber: index + 2, value: {
      ...(values.externalId ? { externalId: values.externalId } : {}),
      phone: values.phone!, countryCode: values.countryCode!,
      ...(values.timezone ? { timezone: values.timezone } : {}),
      ...(values.language ? { language: values.language } : {}),
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    } };
  }) };
}

function normalizeRow(input: unknown, rowNumber: number):
  | { row: NormalizedEnterpriseLeadImportRow }
  | { error: EnterpriseLeadImportErrorDto[] } {
  if (!plainObject(input) || Object.keys(input).some((key) =>
    !["externalId", "phone", "countryCode", "timezone", "language", "attributes"]
      .includes(key))) return { error: [error(rowNumber, "row", "shape_invalid")] };
  const errors: EnterpriseLeadImportErrorDto[] = [];
  const countryCode = bounded(input.countryCode, 2)?.toUpperCase();
  if (!countryCode || !/^[A-Z]{2}$/.test(countryCode) ||
    !supportedCountries.has(countryCode)) errors.push(error(rowNumber,
      "countryCode", "country_unsupported"));
  const phoneInput = bounded(input.phone, 64);
  let phoneE164 = "";
  if (phoneInput && countryCode) {
    const phone = parsePhoneNumberFromString(phoneInput, countryCode as CountryCode);
    if (phone?.isValid() && (!phone.country || phone.country === countryCode)) {
      phoneE164 = phone.number;
    } else errors.push(error(rowNumber, "phone", phone?.country &&
      phone.country !== countryCode ? "phone_country_mismatch" : "phone_invalid"));
  } else errors.push(error(rowNumber, "phone", "phone_invalid"));
  const externalId = optional(input.externalId, 200, "externalId", rowNumber, errors);
  const timezone = optional(input.timezone, 64, "timezone", rowNumber, errors);
  if (timezone && !validTimezone(timezone)) errors.push(error(rowNumber,
    "timezone", "timezone_invalid"));
  const language = optional(input.language, 35, "language", rowNumber, errors);
  if (language && !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) {
    errors.push(error(rowNumber, "language", "language_invalid"));
  }
  const attributes = normalizeAttributes(input.attributes, rowNumber, errors);
  if (errors.length > 0 || !countryCode || !phoneInput || !phoneE164 || !attributes) {
    return { error: errors };
  }
  return { row: { rowNumber, ...(externalId ? { externalId } : {}), phoneInput,
    phoneE164, phoneHint: `+${"*".repeat(phoneE164.length - 5)}${phoneE164.slice(-4)}`,
    countryCode, ...(timezone ? { timezone } : {}),
    ...(language ? { language } : {}), attributes } };
}

function normalizeAttributes(value: unknown, rowNumber: number,
  errors: EnterpriseLeadImportErrorDto[]) {
  if (value === undefined) return {};
  if (!plainObject(value) || Object.keys(value).length > 32 ||
    Object.entries(value).some(([key, item]) =>
      !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) ||
      (!["string", "number", "boolean"].includes(typeof item) && item !== null) ||
      (typeof item === "string" && Buffer.byteLength(item) > 500) ||
      (typeof item === "number" && !Number.isFinite(item))) ||
    Buffer.byteLength(JSON.stringify(value)) > 8_192) {
    errors.push(error(rowNumber, "attributes", "attributes_invalid"));
    return null;
  }
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right))) as Record<string, EnterpriseLeadAttributeValue>;
}

function parseCsv(value: string) {
  const rows: string[][] = []; let row: string[] = []; let field = "";
  let quoted = false; let quoteClosed = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') { quoted = false; quoteClosed = true; }
      else field += character;
    } else if (quoteClosed) {
      if (character === ",") { row.push(field); field = ""; quoteClosed = false; }
      else if (character === "\n") { row.push(field); rows.push(row); row = [];
        field = ""; quoteClosed = false; }
      else if (character !== "\r") return null;
    } else if (character === '"') {
      if (field !== "") return null;
      quoted = true;
    } else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field); rows.push(row); row = [];
      field = ""; }
    else if (character !== "\r") field += character;
  }
  if (quoted) return null;
  row.push(field); if (row.some((item) => item !== "") || rows.length === 0) rows.push(row);
  return rows;
}

function optional(value: unknown, max: number, field: string, row: number,
  errors: EnterpriseLeadImportErrorDto[]) {
  if (value === undefined) return undefined;
  const result = bounded(value, max);
  if (!result) errors.push(error(row, field, `${field}_invalid`));
  return result ?? undefined;
}
function bounded(value: unknown, max: number) { return typeof value === "string" &&
  value === value.trim() && Buffer.byteLength(value) >= 1 &&
  Buffer.byteLength(value) <= max ? value : null; }
function validTimezone(value: string) { try { new Intl.DateTimeFormat("en", {
  timeZone: value }).format(); return true; } catch { return false; } }
function plainObject(value: unknown): value is Record<string, unknown> { return Boolean(value) &&
  typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype; }
function error(rowNumber: number, field: string, code: string) {
  return { rowNumber, field, code };
}
function rejected(totalRows: number, issue: EnterpriseLeadImportErrorDto) {
  return { status: "rejected" as const, totalRows, errors: [issue] };
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
