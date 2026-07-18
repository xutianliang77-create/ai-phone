import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

export interface WorkerDispatchTicketPayload {
  v: 1;
  callId: string;
  sessionId: string;
  roomName: string;
  agentName: string;
  generation: number;
  nonce: string;
  iat: number;
  exp: number;
}

export function issueWorkerDispatchTicket(input: {
  callId: string;
  sessionId: string;
  roomName: string;
  agentName: string;
  generation: number;
  secret: string;
  ttlSeconds: number;
  nonce?: string;
  now?: Date;
}) {
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const payload: WorkerDispatchTicketPayload = {
    v: 1,
    callId: input.callId,
    sessionId: input.sessionId,
    roomName: input.roomName,
    agentName: input.agentName,
    generation: input.generation,
    nonce: input.nonce ?? randomUUID(),
    iat: nowSeconds,
    exp: nowSeconds + input.ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded, input.secret)}`;
}

export function verifyWorkerDispatchTicket(
  ticket: string,
  secret: string,
  now = new Date(),
): WorkerDispatchTicketPayload | null {
  const [encoded, provided, extra] = ticket.split(".");
  if (!encoded || !provided || extra || ticket.length > 4096) return null;
  const expected = signature(encoded, secret);
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(providedBytes, expectedBytes)) return null;
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return validPayload(value, Math.floor(now.getTime() / 1000)) ? value : null;
  } catch {
    return null;
  }
}

export function workerDispatchMetadataHash(ticket: string) {
  return createHash("sha256").update(ticket).digest("hex");
}

export function workerDispatchTicketNonce(input: {
  sessionId: string;
  generation: number;
  secret: string;
}) {
  return createHmac("sha256", input.secret)
    .update(`${input.sessionId}:${input.generation}`)
    .digest("base64url");
}

function validPayload(value: unknown, nowSeconds: number): value is WorkerDispatchTicketPayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.v === 1 && boundedString(item.callId, 128) &&
    boundedString(item.sessionId, 128) && boundedString(item.roomName, 256) &&
    boundedString(item.agentName, 64) && boundedString(item.nonce, 64) &&
    Number.isInteger(item.generation) && Number(item.generation) > 0 &&
    Number.isInteger(item.iat) && Number.isInteger(item.exp) &&
    Number(item.iat) <= nowSeconds + 60 && Number(item.exp) >= nowSeconds &&
    Number(item.exp) - Number(item.iat) <= 3600;
}

function boundedString(value: unknown, maxBytes: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value) <= maxBytes;
}

function signature(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}
