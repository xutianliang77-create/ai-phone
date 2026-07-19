import { createHash } from "node:crypto";
import {
  enterpriseScopes,
  type EnterpriseScope,
  type EnterpriseSupportToolConfirmationMode,
  type EnterpriseSupportToolDefinitionDto,
  type EnterpriseSupportToolDefinitionStatus,
  type EnterpriseSupportToolInputSchema,
  type EnterpriseSupportToolPropertySchema,
  type EnterpriseSupportToolRiskLevel,
} from "@translation/contracts";

export interface EnterpriseSupportToolDefinitionRecord
  extends EnterpriseSupportToolDefinitionDto {
  tenantId: string;
  createdBy: string;
  publishedBy?: string;
  retiredBy?: string;
}

export interface PreparedEnterpriseSupportToolDefinition {
  toolName: string;
  description: string;
  riskLevel: EnterpriseSupportToolRiskLevel;
  requiredScope: EnterpriseScope;
  confirmationMode: EnterpriseSupportToolConfirmationMode;
  inputSchema: EnterpriseSupportToolInputSchema;
  schemaHash: string;
}

export function prepareEnterpriseSupportToolDefinition(input: {
  toolName: unknown;
  description: unknown;
  riskLevel: unknown;
  requiredScope: unknown;
  confirmationMode: unknown;
  inputSchema: unknown;
}): PreparedEnterpriseSupportToolDefinition {
  const toolName = code(input.toolName, 128);
  const description = text(input.description, 500);
  const riskLevel = oneOf(input.riskLevel,
    ["read", "reversible_write", "high_risk"] as const);
  const requiredScope = oneOf(input.requiredScope, enterpriseScopes);
  const confirmationMode = oneOf(input.confirmationMode,
    ["none", "customer_confirmation", "human_handoff"] as const);
  const expected = riskPolicy[riskLevel];
  if (requiredScope !== expected.requiredScope ||
    confirmationMode !== expected.confirmationMode) {
    throw new Error("Support tool risk policy mismatch");
  }
  const inputSchema = prepareSchema(input.inputSchema);
  return { toolName, description, riskLevel, requiredScope, confirmationMode,
    inputSchema, schemaHash: hash(stableJson(inputSchema)) };
}

export function validateEnterpriseSupportToolArguments(
  schema: EnterpriseSupportToolInputSchema,
  value: unknown,
) {
  const args = record(value);
  if (!args || Buffer.byteLength(JSON.stringify(args)) > 8_192) {
    throw new Error("Invalid support tool arguments");
  }
  const keys = Object.keys(args);
  const allowed = new Set(Object.keys(schema.properties));
  if (keys.some((key) => !allowed.has(key)) ||
    schema.required.some((key) => !(key in args))) {
    throw new Error("Invalid support tool arguments");
  }
  for (const [key, item] of Object.entries(args)) {
    if (!matches(schema.properties[key]!, item)) {
      throw new Error("Invalid support tool arguments");
    }
  }
  const canonical = stableJson(args);
  return { arguments: args, argumentsHash: hash(canonical) };
}

export function supportToolDefinitionDto(
  record: EnterpriseSupportToolDefinitionRecord,
): EnterpriseSupportToolDefinitionDto {
  return { id: record.id, toolName: record.toolName, revision: record.revision,
    status: record.status, description: record.description,
    riskLevel: record.riskLevel, requiredScope: record.requiredScope,
    confirmationMode: record.confirmationMode, inputSchema: record.inputSchema,
    schemaHash: record.schemaHash, createdAt: record.createdAt,
    ...(record.publishedAt ? { publishedAt: record.publishedAt } : {}),
    ...(record.retiredAt ? { retiredAt: record.retiredAt } : {}),
    version: record.version };
}

const riskPolicy: Record<EnterpriseSupportToolRiskLevel, {
  requiredScope: EnterpriseScope;
  confirmationMode: EnterpriseSupportToolConfirmationMode;
}> = {
  read: { requiredScope: "support:read", confirmationMode: "none" },
  reversible_write: {
    requiredScope: "support:manage",
    confirmationMode: "customer_confirmation",
  },
  high_risk: {
    requiredScope: "support:takeover",
    confirmationMode: "human_handoff",
  },
};

function prepareSchema(value: unknown): EnterpriseSupportToolInputSchema {
  const schema = record(value);
  if (!schema || !exact(schema,
    ["type", "additionalProperties", "properties", "required"]) ||
    schema.type !== "object" || schema.additionalProperties !== false) {
    throw new Error("Invalid support tool schema");
  }
  const properties = record(schema.properties);
  const required = schema.required;
  if (!properties || !Array.isArray(required) ||
    Object.keys(properties).length > 32 || required.length > 32) {
    throw new Error("Invalid support tool schema");
  }
  const prepared: Record<string, EnterpriseSupportToolPropertySchema> = {};
  for (const key of Object.keys(properties).sort()) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) {
      throw new Error("Invalid support tool schema property");
    }
    prepared[key] = propertySchema(properties[key]);
  }
  if (required.some((key) => typeof key !== "string" || !(key in prepared)) ||
    new Set(required).size !== required.length) {
    throw new Error("Invalid support tool required properties");
  }
  const result: EnterpriseSupportToolInputSchema = { type: "object",
    additionalProperties: false, properties: prepared,
    required: [...required].sort() as string[] };
  if (Buffer.byteLength(stableJson(result)) > 8_192) {
    throw new Error("Support tool schema is too large");
  }
  return result;
}

function propertySchema(value: unknown): EnterpriseSupportToolPropertySchema {
  const property = record(value);
  if (!property || !["string", "number", "integer", "boolean"]
    .includes(String(property.type))) throw new Error("Invalid support tool property");
  if (property.type === "boolean") {
    if (!exact(property, ["type"])) throw new Error("Invalid boolean tool property");
    return { type: "boolean" };
  }
  if (property.type === "string") {
    if (!subset(property, ["type", "minLength", "maxLength", "enum"])) {
      throw new Error("Invalid string tool property");
    }
    const minLength = optionalInteger(property.minLength, 0, 1_000);
    const maxLength = optionalInteger(property.maxLength, 1, 1_000);
    if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
      throw new Error("Invalid string tool bounds");
    }
    const enumeration = property.enum === undefined ? undefined : stringEnum(property.enum);
    return { type: "string", ...(minLength === undefined ? {} : { minLength }),
      ...(maxLength === undefined ? {} : { maxLength }),
      ...(enumeration ? { enum: enumeration } : {}) };
  }
  if (!subset(property, ["type", "minimum", "maximum"])) {
    throw new Error("Invalid numeric tool property");
  }
  const minimum = optionalNumber(property.minimum);
  const maximum = optionalNumber(property.maximum);
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw new Error("Invalid numeric tool bounds");
  }
  const numericType = property.type === "integer" ? "integer" : "number";
  return { type: numericType, ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }) };
}

function matches(schema: EnterpriseSupportToolPropertySchema, value: unknown) {
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "string") return typeof value === "string" &&
    (schema.minLength === undefined || value.length >= schema.minLength) &&
    (schema.maxLength === undefined || value.length <= schema.maxLength) &&
    (!schema.enum || schema.enum.includes(value));
  return typeof value === "number" && Number.isFinite(value) &&
    (schema.type !== "integer" || Number.isSafeInteger(value)) &&
    (schema.minimum === undefined || value >= schema.minimum) &&
    (schema.maximum === undefined || value <= schema.maximum);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
    ? value as Record<string, unknown> : null;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
function subset(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}
function text(value: unknown, maximum: number) {
  if (typeof value !== "string" || !value.trim() ||
    Buffer.byteLength(value.trim()) > maximum) throw new Error("Invalid support tool text");
  return value.trim();
}
function code(value: unknown, maximum: number) {
  const result = text(value, maximum);
  if (!/^[a-z][a-z0-9_.-]{1,127}$/.test(result)) {
    throw new Error("Invalid support tool code");
  }
  return result;
}
function oneOf<const Values extends readonly string[]>(value: unknown, values: Values) {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error("Invalid support tool policy value");
  }
  return value as Values[number];
}
function optionalInteger(value: unknown, minimum: number, maximum: number) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error("Invalid support tool integer");
  }
  return Number(value);
}
function optionalNumber(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Invalid support tool number");
  }
  return value;
}
function stringEnum(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32 ||
    value.some((item) => typeof item !== "string" || !item || item.length > 200) ||
    new Set(value).size !== value.length) throw new Error("Invalid support tool enum");
  return [...value].sort() as string[];
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(
    value as Record<string, unknown>,
  ).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) =>
    `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
