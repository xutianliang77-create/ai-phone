import type {
  EnterpriseClientEventKind,
  EnterpriseClientEventRequest,
} from "@translation/contracts";

export const enterpriseRelease = {
  appVersion: import.meta.env.VITE_ENTERPRISE_RELEASE_VERSION?.trim() || "unversioned",
  releaseCommit: normalizedCommit(
    import.meta.env.VITE_ENTERPRISE_RELEASE_COMMIT?.trim(),
  ),
} as const;

export async function clientErrorEvent(
  kind: Exclude<EnterpriseClientEventKind, "performance">,
  value: unknown,
  routePath: string,
  occurredAt = new Date().toISOString(),
): Promise<EnterpriseClientEventRequest> {
  return {
    kind,
    code: kind === "error" ? "unexpected_client_error" : "unhandled_rejection",
    routePath: safeRoutePath(routePath),
    ...enterpriseRelease,
    occurredAt,
    fingerprint: await hashIdentity(errorIdentity(value)),
  };
}

export function clientPerformanceEvent(
  metricName: string,
  value: number,
  routePath: string,
  occurredAt = new Date().toISOString(),
): EnterpriseClientEventRequest {
  return {
    kind: "performance",
    code: "client_performance",
    routePath: safeRoutePath(routePath),
    ...enterpriseRelease,
    occurredAt,
    metricName,
    value: Math.max(0, Math.min(600_000, Math.round(value))),
  };
}

function errorIdentity(value: unknown) {
  if (value instanceof Error) {
    return `${value.name}\n${value.stack ?? "no_stack"}`;
  }
  return Object.prototype.toString.call(value);
}

async function hashIdentity(value: string) {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(digest).slice(0, 16))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").repeat(4);
}

function safeRoutePath(value: string) {
  const path = value.split(/[?#]/, 1)[0] || "/";
  return path.startsWith("/") && path.length <= 240 ? path : "/invalid-route";
}

function normalizedCommit(value: string | undefined) {
  return value && /^[a-f0-9]{7,40}$/.test(value) ? value : "unversioned";
}
