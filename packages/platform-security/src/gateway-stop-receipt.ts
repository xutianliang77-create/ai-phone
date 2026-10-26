import { createHmac, timingSafeEqual } from "node:crypto";

export interface GatewayStopReceipt {
  purpose: "wujie-v10-gateway-stop-v1";
  sessionId: string;
  userId: string;
  billableSeconds: number;
  providerClosed: true;
  issuedAt: number;
}
const prefix = "wj10stop";
const purpose = "wujie-v10-gateway-stop-v1";

/** Evidence of a completed stop, never a credential for starting inference. */
export function signGatewayStopReceipt(input: Omit<GatewayStopReceipt, "purpose">, secret: string) {
  if (!strongKey(secret) || !validPayload({ ...input, purpose })) throw new Error("Invalid gateway stop receipt input");
  const encoded = Buffer.from(JSON.stringify({ ...input, purpose })).toString("base64url");
  return `${prefix}.${encoded}.${signature(encoded, secret).toString("base64url")}`;
}

export function verifyGatewayStopReceipt(value: unknown, secret: string,
  binding: { sessionId: string; userId: string }, nowMs = Date.now()): GatewayStopReceipt | null {
  if (!strongKey(secret) || typeof value !== "string" || value.length > 4096) return null;
  const [kind, encoded, signed, extra] = value.split(".");
  if (kind !== prefix || !encoded || !signed || extra !== undefined) return null;
  try {
    const actual = Buffer.from(signed, "base64url");
    const expected = signature(encoded, secret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const payload: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!validPayload(payload) || payload.sessionId !== binding.sessionId ||
        payload.userId !== binding.userId || payload.issuedAt > nowMs + 30000) return null;
    return payload;
  } catch { return null; }
}

function strongKey(secret: string) { return typeof secret === "string" && secret.length >= 32 && !/dev-secret|replace-with|changeme/i.test(secret); }
function signature(encoded: string, secret: string) {
  return createHmac("sha256", secret).update(`${purpose}\0${encoded}`).digest();
}
function validPayload(value: unknown): value is GatewayStopReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Partial<GatewayStopReceipt>;
  return p.purpose === purpose && p.providerClosed === true &&
    typeof p.sessionId === "string" && p.sessionId.length > 0 && p.sessionId.length <= 128 &&
    typeof p.userId === "string" && p.userId.length > 0 && p.userId.length <= 128 &&
    Number.isSafeInteger(p.billableSeconds) && p.billableSeconds! >= 0 &&
    Number.isSafeInteger(p.issuedAt) && p.issuedAt! >= 0;
}
