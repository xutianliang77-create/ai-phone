import { z } from "zod";
import type { EnterpriseMeetingCaptionLanguage } from "@translation/contracts";

export interface EnterpriseMeetingWorkerCaptionInput {
  type: "transcript.final" | "translation.final";
  segmentId: string;
  revision: number;
  sourceLanguage: EnterpriseMeetingCaptionLanguage;
  targetLanguage: EnterpriseMeetingCaptionLanguage;
  sourceText: string;
  text: string;
  timestampMs: number;
}

const ticketSchema = z.object({
  v: z.literal(3),
  ticketId: z.string().uuid(),
  tenantId: z.string().uuid(),
  communicationSessionId: z.string().uuid(),
  policySnapshotId: z.string().uuid(),
  policyVersion: z.string().min(1).max(128),
  entitlementVersion: z.string().min(1).max(128),
  cellId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  routeEpoch: z.number().int().positive(),
  generation: z.number().int().positive(),
  capability: z.literal("translation_runtime"),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();

export type EnterpriseMeetingDispatchTicket = z.infer<typeof ticketSchema> & {
  ticket: string;
};

export interface EnterpriseMeetingWorkerSnapshot {
  meetingId: string;
  communicationSessionId: string;
  roomName: string;
  generation: number;
  runtimeState: "full" | "captions_only" | "half_duplex";
  reasonCode: string;
}

export function parseEnterpriseMeetingDispatchMetadata(value: string) {
  if (Buffer.byteLength(value) > 4_096) return null;
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra) return null;
  try {
    const parsed = ticketSchema.safeParse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    if (!parsed.success) return null;
    const issuedAt = Date.parse(parsed.data.issuedAt);
    const expiresAt = Date.parse(parsed.data.expiresAt);
    const now = Date.now();
    return issuedAt <= now + 30_000 && expiresAt > now
      ? { ...parsed.data, ticket: value } : null;
  } catch {
    return null;
  }
}

export function enterpriseMeetingRoomName(communicationSessionId: string) {
  return `ent_${communicationSessionId.replaceAll("-", "")}`;
}

export class EnterpriseMeetingRuntimeClient {
  private readonly fetchFn: typeof fetch;
  private ticket: EnterpriseMeetingDispatchTicket;
  private refreshing: Promise<void> | null = null;

  constructor(private readonly options: {
    apiBaseUrl: string;
    internalApiSecret?: string;
    timeoutMs: number;
    ticket: EnterpriseMeetingDispatchTicket;
    workerId: string;
    fetchFn?: typeof fetch;
  }) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.ticket = options.ticket;
  }

  currentTicket() {
    return this.ticket;
  }

  async snapshot() {
    const response = await this.post<{ status: "accepted"; snapshot:
      EnterpriseMeetingWorkerSnapshot }>("snapshot", this.workerBody(this.ticket));
    if (response.status !== "accepted") throw new Error("Worker snapshot rejected");
    return response.snapshot;
  }

  heartbeat() {
    return this.postCurrent("heartbeat", {});
  }

  refresh() {
    this.refreshing ??= this.performRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  publish(input: {
    sourceParticipantId: string;
    sourceTrackSid: string;
    events: EnterpriseMeetingWorkerCaptionInput[];
  }) {
    return this.postCurrent("events", input);
  }

  finalize(outcome: "completed" | "failed") {
    return this.postCurrent("finalize", { outcome });
  }

  private async performRefresh() {
    const previous = this.ticket;
    const response = await this.post<{
      status: "accepted"; ticket: string; expiresAt: string;
    }>("refresh", this.workerBody(previous));
    const next = parseEnterpriseMeetingDispatchMetadata(response.ticket);
    if (response.status !== "accepted" || !next ||
      next.ticketId !== previous.ticketId || next.tenantId !== previous.tenantId ||
      next.communicationSessionId !== previous.communicationSessionId ||
      next.generation !== previous.generation || next.cellId !== previous.cellId ||
      next.expiresAt !== response.expiresAt) {
      throw new Error("Worker credential refresh binding failed");
    }
    this.ticket = next;
  }

  private async postCurrent(route: string, extra: Record<string, unknown>) {
    const used = this.ticket;
    try {
      return await this.post(route, { ...this.workerBody(used), ...extra });
    } catch (error) {
      if (!(error instanceof RuntimeHttpError) || error.status !== 409) throw error;
      if (this.refreshing) await this.refreshing;
      if (used.ticket === this.ticket.ticket) throw error;
      return this.post(route, { ...this.workerBody(this.ticket), ...extra });
    }
  }

  private workerBody(ticket: EnterpriseMeetingDispatchTicket) {
    return {
      ticket: ticket.ticket,
      workerCellId: ticket.cellId,
      workerId: this.options.workerId,
    };
  }

  private async post<T = unknown>(route: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchFn(
        `${this.options.apiBaseUrl.replace(/\/$/, "")}/internal/enterprise/meeting-translation/${route}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.options.internalApiSecret
              ? { authorization: `Bearer ${this.options.internalApiSecret}` }
              : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new RuntimeHttpError(response.status);
      return await response.json() as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

class RuntimeHttpError extends Error {
  constructor(readonly status: number) {
    super(`Enterprise meeting runtime API returned HTTP ${status}`);
  }
}
