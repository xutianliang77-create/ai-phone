import { createHash } from "node:crypto";

const maxPayloadBytes = 256 * 1024;
const maxPayloadDepth = 24;

export class EnterpriseEventPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnterpriseEventPayloadError";
  }
}

export function normalizeEnterpriseEventPayload(payload: unknown) {
  const normalized = normalizeJson(payload, new WeakSet(), 0);
  const json = JSON.stringify(normalized);
  if (Buffer.byteLength(json) > maxPayloadBytes) {
    throw new EnterpriseEventPayloadError("Enterprise event payload is too large");
  }
  return {
    value: normalized,
    json,
    hash: createHash("sha256").update(json).digest("hex"),
  };
}

function normalizeJson(
  value: unknown,
  ancestors: WeakSet<object>,
  depth: number,
): unknown {
  if (depth > maxPayloadDepth) {
    throw new EnterpriseEventPayloadError("Enterprise event payload is too deep");
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new EnterpriseEventPayloadError("Enterprise event number is invalid");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return withAncestor(value, ancestors, () =>
      value.map((item) => normalizeJson(item, ancestors, depth + 1))
    );
  }
  if (typeof value !== "object") {
    throw new EnterpriseEventPayloadError("Enterprise event payload is not JSON");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new EnterpriseEventPayloadError("Enterprise event object is not plain JSON");
  }
  return withAncestor(value, ancestors, () =>
    Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareKeys(left, right))
        .map(([key, item]) => [
          key,
          normalizeJson(item, ancestors, depth + 1),
        ]),
    )
  );
}

function withAncestor<T extends object, R>(
  value: T,
  ancestors: WeakSet<object>,
  operation: () => R,
) {
  if (ancestors.has(value)) {
    throw new EnterpriseEventPayloadError("Enterprise event payload is cyclic");
  }
  ancestors.add(value);
  try {
    return operation();
  } finally {
    ancestors.delete(value);
  }
}

function compareKeys(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
