import type {
  EnterpriseOutboxEventRecord,
} from "../../modules/enterprise/enterprise-event-record.js";
import type {
  EnterpriseOutboxPublisher,
} from "../../modules/enterprise/enterprise-outbox-processor.js";

export function createEnvironmentEnterpriseOutboxPublisher(options: {
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  timeoutMs?: number;
} = {}): EnterpriseOutboxPublisher {
  const env = options.env ?? process.env;
  const endpoint = publisherEndpoint(
    env.ENTERPRISE_OUTBOX_PUBLISHER_URL?.trim(),
  );
  const token = env.ENTERPRISE_OUTBOX_PUBLISHER_TOKEN?.trim();
  if (!endpoint || !token) {
    throw new Error("Enterprise outbox publisher is not configured");
  }
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  return {
    async publish(event) {
      return publishEvent(fetcher, endpoint, token, timeoutMs, event);
    },
  };
}

async function publishEvent(
  fetcher: typeof fetch,
  endpoint: string,
  token: string,
  timeoutMs: number,
  event: Readonly<EnterpriseOutboxEventRecord>,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": event.id,
      },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
    if (response.ok) return { status: "completed" as const };
    return {
      status: "retry" as const,
      reason: transientStatus(response.status)
        ? "publisher_unavailable"
        : "publisher_rejected",
    };
  } catch {
    return { status: "retry" as const, reason: "publisher_unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

function publisherEndpoint(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function transientStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
