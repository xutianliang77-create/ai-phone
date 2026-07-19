import { z } from "zod";

const ticketSchema = z.object({
  v: z.literal(1),
  runId: z.string().uuid(),
  tenantId: z.string().uuid(),
  meetingId: z.string().uuid(),
  communicationSessionId: z.string().uuid(),
  shareId: z.string().uuid(),
  shareGeneration: z.number().int().positive(),
  publisherIdentity: z.string().min(1).max(200),
  trackSid: z.string().min(1).max(128),
  targetLanguage: z.enum(["zh", "en"]),
  cellId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  routeEpoch: z.number().int().positive(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();

export type EnterpriseScreenOcrTicket = z.infer<typeof ticketSchema> & {
  ticket: string;
};

export interface EnterpriseScreenOcrBlock {
  rect: { left: number; top: number; width: number; height: number };
  sourceLanguage: "zh" | "en";
  sourceText: string;
  translatedText: string;
}

export function parseEnterpriseScreenOcrMetadata(value: string) {
  if (Buffer.byteLength(value) > 4_096) return null;
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra) return null;
  try {
    const parsed = ticketSchema.safeParse(JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ));
    if (!parsed.success) return null;
    const now = Date.now();
    return Date.parse(parsed.data.issuedAt) <= now + 30_000 &&
      Date.parse(parsed.data.expiresAt) > now
      ? { ...parsed.data, ticket: value } : null;
  } catch { return null; }
}

export function enterpriseMeetingRoomName(communicationSessionId: string) {
  return `ent_${communicationSessionId.replaceAll("-", "")}`;
}

export class EnterpriseScreenOcrRuntimeClient {
  private ticket: EnterpriseScreenOcrTicket;
  private refreshing: Promise<void> | null = null;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: {
    apiBaseUrl: string;
    internalApiSecret?: string;
    timeoutMs: number;
    ticket: EnterpriseScreenOcrTicket;
    fetchFn?: typeof fetch;
  }) {
    this.ticket = options.ticket;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  currentTicket() { return this.ticket; }

  snapshot() {
    return this.post("snapshot", { ticket: this.ticket.ticket });
  }

  refresh() {
    this.refreshing ??= this.performRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  claim(input: { frameId: string; perceptualHash: string; sourceWidth: number;
    sourceHeight: number; capturedAt: string }) {
    return this.postCurrent("frames/claim", input) as Promise<{
      status: "claimed" | "unchanged" | "duplicate";
      frameId?: string; frameRevision?: number;
    }>;
  }

  complete(input: { frameId: string; providerFingerprint: string;
    blocks: EnterpriseScreenOcrBlock[] }) {
    return this.postCurrent("frames/complete", input);
  }

  fail(input: { frameId: string; reasonCode: string;
    providerFingerprint?: string }) {
    return this.postCurrent("frames/fail", input);
  }

  failRun(reasonCode: string) {
    return this.postCurrent("run/fail", { reasonCode });
  }

  private async performRefresh() {
    const previous = this.ticket;
    const response = await this.post("refresh", { ticket: previous.ticket }) as {
      status: "accepted"; ticket: string; expiresAt: string;
    };
    const next = parseEnterpriseScreenOcrMetadata(response.ticket);
    if (response.status !== "accepted" || !next || next.runId !== previous.runId ||
      next.tenantId !== previous.tenantId || next.meetingId !== previous.meetingId ||
      next.shareId !== previous.shareId ||
      next.shareGeneration !== previous.shareGeneration ||
      next.publisherIdentity !== previous.publisherIdentity ||
      next.trackSid !== previous.trackSid || next.cellId !== previous.cellId ||
      next.routeEpoch !== previous.routeEpoch || next.expiresAt !== response.expiresAt) {
      throw new Error("Enterprise screen OCR ticket refresh binding failed");
    }
    this.ticket = next;
  }

  private async postCurrent(route: string, extra: Record<string, unknown>) {
    const used = this.ticket;
    try {
      return await this.post(route, { ticket: used.ticket, ...extra });
    } catch (error) {
      if (!(error instanceof ScreenOcrRuntimeHttpError) || error.status !== 409 ||
        !this.refreshing) throw error;
      await this.refreshing;
      return this.post(route, { ticket: this.ticket.ticket, ...extra });
    }
  }

  private async post(route: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchFn(
        `${this.options.apiBaseUrl.replace(/\/$/, "")}` +
          `/internal/enterprise/meeting-screen-ocr/${route}`,
        { method: "POST", headers: { "content-type": "application/json",
          ...(this.options.internalApiSecret
            ? { authorization: `Bearer ${this.options.internalApiSecret}` } : {}) },
          body: JSON.stringify(body), signal: controller.signal },
      );
      if (!response.ok) throw new ScreenOcrRuntimeHttpError(response.status);
      return await response.json();
    } finally { clearTimeout(timer); }
  }
}

class ScreenOcrRuntimeHttpError extends Error {
  constructor(readonly status: number) {
    super(`Enterprise screen OCR runtime returned HTTP ${status}`);
  }
}
