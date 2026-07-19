import { Pool } from "pg";
import {
  buildPostgresPoolConfig,
  getPostgresProjectionConfig,
} from "./postgres-projection-config.js";
import {
  acknowledgePostgresProjectionEvent,
  failPostgresProjectionEvent,
  nextPostgresProjectionEvents,
} from "./postgres-projection.repository.js";
import {
  recordPostgresProjectionFailure,
  recordPostgresProjectionSuccess,
  updatePostgresProjectionRuntime,
} from "./postgres-projection-status.js";
import { applyPostgresProjectionEvent } from "./postgres-projection-apply.js";

export interface PostgresProjectionWorkerCallbacks {
  onApplied?: (eventId: string) => void;
  onError?: (error: unknown, eventId?: string) => void;
}

export async function startPostgresProjectionWorker(
  callbacks: PostgresProjectionWorkerCallbacks = {},
) {
  const config = getPostgresProjectionConfig();
  if (!config.enabled) {
    updatePostgresProjectionRuntime({ state: "disabled" });
    return async () => undefined;
  }

  updatePostgresProjectionRuntime({ state: "starting" });
  const pool = new Pool(buildPostgresPoolConfig(config));
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      running = drainBatch().finally(() => {
        running = undefined;
        schedule();
      });
    }, config.pollIntervalMs);
    timer.unref();
  };

  const drainBatch = async () => {
    try {
      const events = nextPostgresProjectionEvents(config.batchSize);
      if (events.length === 0) {
        await pool.query("SELECT 1 FROM ai_phone.schema_migrations LIMIT 1");
        updatePostgresProjectionRuntime({ state: "ready" });
        return;
      }
      for (const event of events) {
        if (stopped) break;
        try {
          await applyEvent(pool, event);
          acknowledgePostgresProjectionEvent(event.id);
          recordPostgresProjectionSuccess();
          callbacks.onApplied?.(event.id);
        } catch (error) {
          failPostgresProjectionEvent(event.id, error);
          recordPostgresProjectionFailure(error);
          callbacks.onError?.(error, event.id);
          break;
        }
      }
    } catch (error) {
      recordPostgresProjectionFailure(error);
      callbacks.onError?.(error);
    }
  };

  running = drainBatch().finally(() => {
    running = undefined;
    schedule();
  });
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await running;
    await pool.end();
    updatePostgresProjectionRuntime({ state: "stopped" });
  };
}

async function applyEvent(
  pool: Pool,
  event: {
    id: string;
    namespace: string;
    recordKey: string;
    operation: string;
    payload?: unknown;
  },
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await applyPostgresProjectionEvent(client, event);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
