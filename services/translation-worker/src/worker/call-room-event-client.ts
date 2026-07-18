import type { CallRoomSubmittedEvent } from "@translation/contracts";
import type {
  CallPlaybackBinding,
  CallRoomEventSink,
  CallRoomPublishResult,
} from "./types.js";

export interface HttpCallRoomEventClientOptions {
  apiBaseUrl: string;
  internalApiSecret?: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

export class CallRoomEndedError extends Error {
  readonly code = "call_room_ended";

  constructor(readonly callId: string) {
    super(`Call room ${callId} has ended`);
    this.name = "CallRoomEndedError";
  }
}

export function isCallRoomEndedError(error: unknown): error is CallRoomEndedError {
  return error instanceof CallRoomEndedError || (
    error instanceof Error &&
    "code" in error &&
    error.code === "call_room_ended"
  );
}

export class HttpCallRoomEventClient implements CallRoomEventSink {
  private readonly fetchFn: typeof fetch;
  private readonly sessionVersions = new Map<string, number>();
  private readonly publicationTails = new Map<string, Promise<void>>();
  private readonly endedCalls = new Set<string>();

  constructor(private readonly options: HttpCallRoomEventClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async publish(callId: string, events: CallRoomSubmittedEvent[]) {
    if (events.length === 0) return {};
    if (this.endedCalls.has(callId)) throw new CallRoomEndedError(callId);
    const previous = this.publicationTails.get(callId) ?? Promise.resolve();
    const publication = previous.catch(() => undefined).then(() =>
      this.publishBatch(callId, events)
    );
    const tail = publication.then(() => undefined, () => undefined);
    this.publicationTails.set(callId, tail);
    try {
      return await publication;
    } finally {
      if (this.publicationTails.get(callId) === tail) {
        this.publicationTails.delete(callId);
      }
    }
  }

  private async publishBatch(callId: string, events: CallRoomSubmittedEvent[]) {
    if (this.endedCalls.has(callId)) throw new CallRoomEndedError(callId);
    let response = await this.postEvents(callId, events);
    if (response.status === 409) {
      const conflict = await readJson(response);
      const currentVersion = integerValue(conflict?.currentVersion);
      if (currentVersion !== undefined) {
        this.sessionVersions.set(callId, currentVersion);
        response = await this.postEvents(callId, events);
      }
    }
    if (response.status === 410) {
      this.endedCalls.add(callId);
      this.sessionVersions.delete(callId);
      throw new CallRoomEndedError(callId);
    }
    if (!response.ok) {
      throw new Error(`Call room event API returned HTTP ${response.status}`);
    }
    const result = await readJson(response);
    const sessionVersion = integerValue(result?.sessionVersion);
    if (sessionVersion !== undefined) {
      this.sessionVersions.set(callId, sessionVersion);
    }
    const bindings = playbackBindings(result?.playbackBindings);
    assertQueuedPlaybackBindings(events, bindings);
    return { playbackBindings: bindings } satisfies CallRoomPublishResult;
  }

  private postEvents(callId: string, events: CallRoomSubmittedEvent[]) {
    const expectedVersion = this.sessionVersions.get(callId);
    return this.fetchWithTimeout(this.eventsUrl(callId), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.options.internalApiSecret
          ? { authorization: `Bearer ${this.options.internalApiSecret}` }
          : {}),
      },
      body: JSON.stringify({
        events,
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      }),
    });
  }

  private async fetchWithTimeout(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private eventsUrl(callId: string) {
    return `${this.options.apiBaseUrl.replace(/\/$/, "")}/internal/call-links/${
      encodeURIComponent(callId)
    }/events`;
  }
}

function playbackBindings(value: unknown): CallPlaybackBinding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const binding = item as Record<string, unknown>;
    if (
      typeof binding.playbackId !== "string" ||
      binding.playbackId.trim().length === 0 ||
      !Number.isInteger(binding.generation) ||
      Number(binding.generation) < 1 ||
      typeof binding.sourceLegId !== "string" ||
      binding.sourceLegId.trim().length === 0 ||
      typeof binding.targetLegId !== "string" ||
      binding.targetLegId.trim().length === 0
    ) return [];
    return [{
      playbackId: binding.playbackId,
      generation: Number(binding.generation),
      sourceLegId: binding.sourceLegId,
      targetLegId: binding.targetLegId,
    }];
  });
}

function assertQueuedPlaybackBindings(
  events: CallRoomSubmittedEvent[],
  bindings: CallPlaybackBinding[],
) {
  for (const event of events) {
    if (event.type !== "playback.queued") continue;
    const binding = bindings.find((candidate) =>
      candidate.playbackId === event.playbackId &&
      candidate.generation === event.generation
    );
    if (!binding) {
      throw new Error("Call room event API missing persisted playback binding");
    }
  }
}

async function readJson(response: Response) {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

function integerValue(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : undefined;
}
