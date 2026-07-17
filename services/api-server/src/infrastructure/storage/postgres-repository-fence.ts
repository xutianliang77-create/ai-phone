import type { PostgresAggregateFence } from "./postgres-primary-store.js";
import { getRepositoryRuntime } from "./repository-runtime.js";

export class PostgresAggregateBusyError extends Error {
  constructor(aggregateType: string, aggregateId: string) {
    super(`PostgreSQL aggregate is owned elsewhere: ${aggregateType}/${aggregateId}`);
    this.name = "PostgresAggregateBusyError";
  }
}

export async function withPostgresRepositoryFence<T>(
  input: { aggregateType: string; aggregateId: string; leaseSeconds?: number },
  operation: (fence: PostgresAggregateFence) => Promise<T>,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    throw new Error("PostgreSQL Repository fence requires the postgres driver");
  }
  const ownerId = process.env.PLATFORM_INSTANCE_ID?.trim();
  if (!ownerId || ownerId.length < 8) {
    throw new Error("PLATFORM_INSTANCE_ID is required for PostgreSQL writes");
  }
  const lease = await runtime.postgres.leases.acquire({
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    ownerId,
    leaseSeconds: input.leaseSeconds ?? 30,
  });
  if (!lease) throw new PostgresAggregateBusyError(
    input.aggregateType,
    input.aggregateId,
  );
  return operation({
    aggregateType: lease.aggregateType,
    aggregateId: lease.aggregateId,
    ownerId: lease.ownerId,
    fencingToken: lease.fencingToken,
  });
}
