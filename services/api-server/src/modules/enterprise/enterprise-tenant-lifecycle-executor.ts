import { createHash } from "node:crypto";
import {
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  EnterpriseTenantJobType,
} from "@translation/contracts";
import type {
  EnterpriseTenantLifecycleSnapshot,
} from "./enterprise-tenant-record.js";

type Environment = Record<string, string | undefined>;
type ExecutableJobType = Extract<
  EnterpriseTenantJobType,
  "tenant.export" | "tenant.delete"
>;

export interface TenantLifecycleExecutionInput {
  job: {
    id: string;
    tenantId: string;
    type: ExecutableJobType;
    attempt: number;
  };
  snapshot: EnterpriseTenantLifecycleSnapshot;
}

export type TenantLifecycleExecutionResult =
  | { status: "completed"; receiptRef: string; receiptHash: string }
  | { status: "processing" }
  | { status: "retry"; reason: string }
  | { status: "failed"; reason: string };

export interface TenantLifecycleExecutor {
  execute(
    input: TenantLifecycleExecutionInput,
  ): Promise<TenantLifecycleExecutionResult>;
}

export function createEnvironmentTenantLifecycleExecutor(options: {
  env?: Environment;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
} = {}): TenantLifecycleExecutor {
  const env = options.env ?? process.env;
  const endpointValue =
    env.ENTERPRISE_TENANT_LIFECYCLE_EXECUTOR_URL?.trim();
  const endpoint = executorEndpoint(endpointValue);
  const token = env.ENTERPRISE_TENANT_LIFECYCLE_EXECUTOR_TOKEN?.trim();
  if (endpointValue || token) {
    if (!endpoint || !token) return failedExecutor("executor_configuration_invalid");
    return httpExecutor({
      endpoint,
      token,
      fetcher: options.fetcher ?? fetch,
      timeoutMs: options.timeoutMs ?? executorTimeoutMs(env),
    });
  }
  const localDirectory = env.ENTERPRISE_TENANT_LIFECYCLE_LOCAL_DIR?.trim();
  if (!localDirectory) return failedExecutor("executor_not_configured");
  if (env.NODE_ENV === "production") {
    return failedExecutor("local_executor_forbidden");
  }
  return localExecutor(resolve(localDirectory), options.now ?? (() => new Date()));
}

function httpExecutor(options: {
  endpoint: string;
  token: string;
  fetcher: typeof fetch;
  timeoutMs: number;
}): TenantLifecycleExecutor {
  return {
    async execute(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const response = await options.fetcher(options.endpoint, {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${options.token}`,
            "content-type": "application/json",
            "idempotency-key": input.job.id,
          },
          body: JSON.stringify(input),
          signal: controller.signal,
        });
        if (response.status === 202) return { status: "processing" };
        if (transientStatus(response.status)) {
          return { status: "retry", reason: "executor_unavailable" };
        }
        if (!response.ok) return { status: "failed", reason: "executor_rejected" };
        return parseExecutorReceipt(await readJson(response), input);
      } catch {
        return { status: "retry", reason: "executor_unavailable" };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function localExecutor(root: string, now: () => Date): TenantLifecycleExecutor {
  return {
    async execute(input) {
      if (!safePathSegment(input.job.id) || !safePathSegment(input.job.tenantId)) {
        return { status: "failed", reason: "invalid_lifecycle_identifier" };
      }
      return input.job.type === "tenant.export"
        ? writeLocalExport(root, input)
        : writeLocalDeletion(root, input, now);
    },
  };
}

async function writeLocalExport(
  root: string,
  input: TenantLifecycleExecutionInput,
): Promise<TenantLifecycleExecutionResult> {
  const directory = resolve(root, "tenants", input.job.tenantId, "exports");
  const file = resolve(directory, `${input.job.id}.json`);
  const content = jsonArtifact({
    schemaVersion: 1,
    operation: "tenant.export",
    job: input.job,
    snapshot: input.snapshot,
  });
  await writeAtomic(file, content);
  return {
    status: "completed",
    receiptRef: `local-export:${input.job.id}`,
    receiptHash: sha256(content),
  };
}

async function writeLocalDeletion(
  root: string,
  input: TenantLifecycleExecutionInput,
  now: () => Date,
): Promise<TenantLifecycleExecutionResult> {
  await rm(resolve(root, "tenants", input.job.tenantId), {
    recursive: true,
    force: true,
  });
  const content = jsonArtifact({
    schemaVersion: 1,
    operation: "tenant.delete",
    job: input.job,
    tenantVersion: input.snapshot.tenant.version,
    snapshotHash: sha256(jsonArtifact(input.snapshot)),
    completedAt: now().toISOString(),
  });
  await writeAtomic(resolve(root, "receipts", `${input.job.id}.json`), content);
  return {
    status: "completed",
    receiptRef: `local-delete:${input.job.id}`,
    receiptHash: sha256(content),
  };
}

function parseExecutorReceipt(
  value: unknown,
  input: TenantLifecycleExecutionInput,
): TenantLifecycleExecutionResult {
  if (!value || typeof value !== "object") {
    return { status: "failed", reason: "invalid_executor_receipt" };
  }
  const record = value as Record<string, unknown>;
  if (record.status === "processing") return { status: "processing" };
  if (record.status === "failed") {
    return {
      status: "failed",
      reason: safeReason(record.reasonCode, "executor_failed"),
    };
  }
  if (
    record.status !== "completed" ||
    record.tenantId !== input.job.tenantId ||
    record.jobId !== input.job.id ||
    !validReceiptRef(record.receiptRef) ||
    !validReceiptHash(record.receiptHash)
  ) {
    return { status: "failed", reason: "invalid_executor_receipt" };
  }
  return {
    status: "completed",
    receiptRef: record.receiptRef,
    receiptHash: record.receiptHash,
  };
}

async function readJson(response: Response) {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

async function writeAtomic(file: string, content: string) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

function executorEndpoint(raw: string | undefined) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function failedExecutor(reason: string): TenantLifecycleExecutor {
  return { async execute() { return { status: "failed", reason }; } };
}

function executorTimeoutMs(env: Environment) {
  const value = Number(
    env.ENTERPRISE_TENANT_LIFECYCLE_EXECUTOR_TIMEOUT_MS,
  );
  return Number.isFinite(value) && value >= 1_000 && value <= 60_000
    ? value
    : 10_000;
}

function transientStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function validReceiptRef(value: unknown): value is string {
  return typeof value === "string" &&
    /^[A-Za-z][A-Za-z0-9._:-]{1,159}$/.test(value);
}

function validReceiptHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function safeReason(value: unknown, fallback: string) {
  return typeof value === "string" && /^[a-z][a-z0-9_]{1,63}$/.test(value)
    ? value
    : fallback;
}

function safePathSegment(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(value);
}

function jsonArtifact(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
