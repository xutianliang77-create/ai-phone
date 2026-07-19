import type { EnterpriseMarketingAgentContext, EnterprisePstnContext } from "./types.js";

export function parseEnterpriseMarketingAgentContext(input: unknown):
  EnterpriseMarketingAgentContext | null {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype) return null;
  const value = input as Record<string, unknown>;
  const keys = ["runtimeUrl", "ticket", "runId", "disclosureRequired"];
  if (Object.keys(value).sort().join(",") !== keys.sort().join(",")) return null;
  const runtimeUrl = text(value.runtimeUrl, 1_000);
  const ticket = text(value.ticket, 4_096);
  const runId = text(value.runId, 36);
  try {
    const parsed = new URL(runtimeUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  } catch { return null; }
  return ticket && uuid(runId) && value.disclosureRequired === true
    ? { runtimeUrl: runtimeUrl.replace(/\/$/u, ""), ticket, runId,
      disclosureRequired: true } : null;
}

export function enterpriseMarketingAgentBindingMatches(
  agent: EnterpriseMarketingAgentContext,
  context: EnterprisePstnContext,
  callId: string,
) {
  const [encoded, signature, extra] = agent.ticket.split(".");
  if (!encoded || !signature || extra) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const value = payload as Record<string, unknown>;
    const keys = ["ticketId", "tenantId", "runId", "dispatchId", "taskId",
      "communicationSessionId", "dispatchGeneration", "routeEpoch", "expiresAt"];
    return Object.keys(value).sort().join(",") === keys.sort().join(",") &&
      uuid(String(value.ticketId)) && uuid(String(value.dispatchId)) &&
      uuid(String(value.communicationSessionId)) &&
      value.tenantId === context.tenantId && value.runId === agent.runId &&
      value.taskId === context.taskId && value.communicationSessionId === callId &&
      value.dispatchGeneration === context.dispatchGeneration &&
      value.routeEpoch === context.routeEpoch && typeof value.expiresAt === "string" &&
      new Date(value.expiresAt).toISOString() === value.expiresAt &&
      Date.parse(value.expiresAt) > Date.now();
  } catch { return false; }
}

function text(value: unknown, max: number) { return typeof value === "string" &&
  value === value.trim() && Boolean(value) && Buffer.byteLength(value) <= max ? value : ""; }
function uuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  .test(value); }
