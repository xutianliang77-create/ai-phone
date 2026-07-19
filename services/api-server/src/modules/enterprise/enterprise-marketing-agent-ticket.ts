import { createHmac, timingSafeEqual } from "node:crypto";

export interface EnterpriseMarketingAgentTicketPayload {
  ticketId: string;
  tenantId: string;
  runId: string;
  dispatchId: string;
  taskId: string;
  communicationSessionId: string;
  dispatchGeneration: number;
  routeEpoch: number;
  expiresAt: string;
}

export interface EnterpriseMarketingAgentRuntimeBinding {
  readiness(): { status: "ready"; runtimeUrl: string } |
    { status: "not_configured" | "not_ready"; reasonCode: string };
  issue(payload: EnterpriseMarketingAgentTicketPayload): string;
  verify(ticket: string): EnterpriseMarketingAgentTicketPayload | null;
}

export function createEnvironmentEnterpriseMarketingAgentRuntimeBinding(
  env: NodeJS.ProcessEnv = process.env,
): EnterpriseMarketingAgentRuntimeBinding {
  const secret = env.ENTERPRISE_MARKETING_AGENT_TICKET_SECRET?.trim() ?? "";
  const runtimeUrl = httpsUrl(env.ENTERPRISE_MARKETING_AGENT_RUNTIME_URL?.trim());
  if (Buffer.byteLength(secret) < 32) return unavailable("agent_ticket_secret_missing");
  if (!runtimeUrl) return unavailable("agent_runtime_url_missing");
  return {
    readiness: () => ({ status: "ready", runtimeUrl }),
    issue(payload) {
      const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
      return `${encoded}.${signature(secret, encoded)}`;
    },
    verify(ticket) {
      if (Buffer.byteLength(ticket) > 4_096) return null;
      const [encoded, supplied, extra] = ticket.split(".");
      if (!encoded || !supplied || extra) return null;
      const expected = Buffer.from(signature(secret, encoded));
      const actual = Buffer.from(supplied);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
      try {
        const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
        return valid(payload) ? payload : null;
      } catch { return null; }
    },
  };
}

export function marketingAgentTicketExpiry(now = new Date()) {
  const seconds = envInt("ENTERPRISE_MARKETING_AGENT_TICKET_TTL_SECONDS",
    1_800, 300, 3_600);
  return new Date(now.getTime() + seconds * 1_000).toISOString();
}

function valid(value: unknown): value is EnterpriseMarketingAgentTicketPayload {
  const item = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
  return Boolean(item && Object.keys(item).sort().join(",") === ["ticketId", "tenantId",
    "runId", "dispatchId", "taskId", "communicationSessionId",
    "dispatchGeneration", "routeEpoch", "expiresAt"].sort().join(",") &&
    uuid(item.ticketId) && uuid(item.tenantId) && uuid(item.runId) &&
    uuid(item.dispatchId) && uuid(item.taskId) && uuid(item.communicationSessionId) &&
    positive(item.dispatchGeneration) && positive(item.routeEpoch) &&
    typeof item.expiresAt === "string" && new Date(item.expiresAt).toISOString() ===
      item.expiresAt && Date.parse(item.expiresAt) > Date.now());
}
function signature(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}
function httpsUrl(value: string | undefined) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username &&
    !url.password ? url.toString().replace(/\/$/u, "") : null; } catch { return null; }
}
function uuid(value: unknown) { return typeof value === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value); }
function positive(value: unknown) { return typeof value === "number" &&
  Number.isSafeInteger(value) && value > 0; }
function envInt(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value >= minimum && value <= maximum
    ? value : fallback;
}
function unavailable(reasonCode: string): EnterpriseMarketingAgentRuntimeBinding {
  return { readiness: () => ({ status: "not_configured", reasonCode }),
    issue: () => { throw new Error(reasonCode); }, verify: () => null };
}
