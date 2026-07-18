import type {
  EnterpriseOutboxEventRecord,
} from "./enterprise-event-record.js";
import {
  claimEnterpriseOutboxEvent,
  finalizeEnterpriseOutboxEvent,
  pendingEnterpriseOutboxEventRefs,
} from "./enterprise-outbox.repository.js";
import {
  createEnterpriseTenantContext,
} from "./enterprise-tenant-context.js";
import { runWithPlatformTraceId } from
  "../../infrastructure/observability/platform-telemetry.js";

export interface EnterpriseOutboxPublisher {
  publish(event: Readonly<EnterpriseOutboxEventRecord>): Promise<
    | { status: "completed" }
    | { status: "retry"; reason: string }
  >;
}

interface EnterpriseOutboxEventRef {
  eventId: string;
  tenantId: string;
}

export async function processEnterpriseOutboxEvent(
  ref: EnterpriseOutboxEventRef,
  publisher: EnterpriseOutboxPublisher,
  options: { now?: Date } = {},
) {
  const claimNow = options.now ?? new Date();
  const context = createEnterpriseTenantContext({
    tenantId: ref.tenantId,
    actorUserId: "system:enterprise-outbox",
    traceId: `outbox:${ref.eventId}`,
  });
  const claimed = claimEnterpriseOutboxEvent({
    context,
    eventId: ref.eventId,
    now: claimNow,
  });
  if (claimed.status !== "claimed") return claimed;
  let result: Awaited<ReturnType<EnterpriseOutboxPublisher["publish"]>>;
  try {
    result = await runWithPlatformTraceId(
      claimed.event.traceId,
      () => publisher.publish(claimed.event),
    );
  } catch {
    result = { status: "retry", reason: "publisher_unavailable" };
  }
  return finalizeEnterpriseOutboxEvent({
    context: createEnterpriseTenantContext({
      tenantId: claimed.event.tenantId,
      actorUserId: "system:enterprise-outbox",
      traceId: claimed.event.traceId,
    }),
    eventId: ref.eventId,
    attempt: claimed.attempt,
    result,
    now: options.now ?? new Date(),
  });
}

export async function recoverPendingEnterpriseOutboxEvents(
  publisher: EnterpriseOutboxPublisher,
  now?: Date,
) {
  const scanNow = now ?? new Date();
  const refs = pendingEnterpriseOutboxEventRefs(scanNow);
  const results = await mapWithConcurrency(
    refs,
    4,
    (ref) => processEnterpriseOutboxEvent(
      ref,
      publisher,
      now ? { now } : {},
    ),
  );
  return {
    inspectedCount: refs.length,
    publishedCount: results.filter((result) =>
      result.status === "updated" && Boolean(result.event.publishedAt)
    ).length,
    retriedCount: results.filter((result) =>
      result.status === "updated" && !result.event.publishedAt
    ).length,
  };
}

async function mapWithConcurrency<Input, Output>(
  inputs: Input[],
  concurrency: number,
  operation: (input: Input) => Promise<Output>,
) {
  const results = new Array<Output>(inputs.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, inputs.length) },
      async () => {
        while (nextIndex < inputs.length) {
          const index = nextIndex++;
          results[index] = await operation(inputs[index]!);
        }
      },
    ),
  );
  return results;
}
