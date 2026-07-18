import type { Pool } from "pg";
import {
  PostgresPrimaryStore,
  type PostgresAggregateFence,
} from "../../infrastructure/storage/postgres-primary-store.js";
import {
  assertDomainFence,
  bounded,
  domainCommand,
  domainEventId,
  enqueueDomainEvent,
  recordDomainCommand,
  validTimestamp,
} from "../../infrastructure/storage/postgres-domain-record-uow.js";
import type { PostgresBillingNotificationRecord } from
  "./postgres-billing-records.js";

export class PostgresBillingNotificationsRepository {
  private readonly primary: PostgresPrimaryStore;

  constructor(pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  async record(input: {
    notification: PostgresBillingNotificationRecord;
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
  }) {
    assertDomainFence(input.fence, "billing_notification", input.notification.id);
    requireNotification(input.notification, input.notification.id);
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "billing.notification.record",
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction(input.fence, async (transaction) => {
      const replay = await transaction
        .readCommandResult<{ status: string; notification: PostgresBillingNotificationRecord }>(
          command,
        );
      if (replay) return replay;
      const existing = await transaction.read<PostgresBillingNotificationRecord>(
        "billingNotifications", input.notification.id,
      );
      if (existing) {
        const notification = requireNotification(existing.payload, input.notification.id);
        return recordDomainCommand(transaction, command, {
          status: notification.requestHash === input.requestHash
            ? "replayed" : "payload_conflict",
          notification,
        });
      }
      const eventId = domainEventId(input.commandId, "billing:notification");
      const stored = await transaction.mutate<PostgresBillingNotificationRecord>({
        eventId,
        namespace: "billingNotifications",
        recordKey: input.notification.id,
        operation: "upsert",
        payload: input.notification,
        expectedRecordVersion: null,
      });
      const notification = requireNotification(stored?.payload, input.notification.id);
      await enqueueDomainEvent(transaction, {
        eventId,
        eventType: "billing.notification.recorded",
        aggregateVersion: 1,
        payload: { notification },
      });
      return recordDomainCommand(transaction, command, {
        status: "recorded", notification,
      });
    });
  }

  async find(notificationId: string) {
    const primary = await this.primary.read<PostgresBillingNotificationRecord>(
      "billingNotifications", notificationId,
    );
    return primary ? requireNotification(primary.payload, notificationId) : null;
  }
}

function requireNotification(value: unknown, id: string) {
  const record = value as Partial<PostgresBillingNotificationRecord> | null;
  if (!record || record.id !== id || !bounded(record.provider ?? "", 80) ||
    !bounded(record.notificationType ?? "", 160) ||
    !bounded(record.action ?? "", 80) ||
    !bounded(record.requestHash ?? "", 128) ||
    (record.requestHash?.length ?? 0) < 16 || !validTimestamp(record.receivedAt)) {
    throw new Error("Invalid PostgreSQL billing notification");
  }
  return record as PostgresBillingNotificationRecord;
}
