import { createHash } from "node:crypto";

export function repositoryRequestHash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function repositoryCommandId(input: {
  aggregateId: string;
  operation: string;
  version: number;
  requestHash: string;
}) {
  return `cmd_${repositoryRequestHash(input)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}
