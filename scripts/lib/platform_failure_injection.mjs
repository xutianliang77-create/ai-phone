import { createHash } from "node:crypto";
import { redactPhoneNumbers } from "./phone_redaction.mjs";

const operationStatuses = new Set([
  "accepted", "injecting", "recovering", "recovered", "failed",
]);

export async function runPlatformFailureInjection(options) {
  const nowMs = options.nowMs ?? Date.now;
  const startedAtMs = nowMs();
  const request = injectionRequest(options);
  const first = await controllerRequest(options, "v1/failure-operations", {
    method: "POST",
    body: request,
    idempotencyKey: request.idempotencyKey,
  });
  assertOperation(first, request, { startedAtMs, options });
  const replay = await controllerRequest(options, "v1/failure-operations", {
    method: "POST",
    body: request,
    idempotencyKey: request.idempotencyKey,
  });
  assertOperation(replay, request, { startedAtMs, options });
  if (replay.operationId !== first.operationId || replay.replayed !== true) {
    throw new Error("Failure injection idempotency replay gate failed");
  }
  const final = await waitForRecovery(options, request, replay, startedAtMs);
  const injectionEvidence = evidence(final.injectionEvidence);
  const recoveryEvidence = evidence(final.recoveryEvidence);
  if (injectionEvidence.length === 0 || recoveryEvidence.length === 0) {
    throw new Error("Failure controller recovery evidence is incomplete");
  }
  const injectionAtMs = Date.parse(final.injectionObservedAt);
  const recoveredAtMs = Date.parse(final.recoveredAt);
  const observedRecoverySeconds = (recoveredAtMs - injectionAtMs) / 1000;
  if (!Number.isFinite(observedRecoverySeconds) || observedRecoverySeconds < 0 ||
    observedRecoverySeconds > options.recoveryTimeoutSeconds) {
    throw new Error("Failure recovery exceeded its acceptance bound");
  }
  return {
    schemaVersion: 1,
    status: "passed",
    environment: "staging",
    realProviderTraffic: true,
    failureName: options.failureName,
    target: options.target,
    fault: options.fault,
    operationId: final.operationId,
    injectionObserved: true,
    providerEvidence: evidence([
      `operation:${final.operationId}`,
      ...injectionEvidence,
    ]),
    recovered: true,
    recoveryEvidence,
    observedRecoverySeconds,
    providerSideEffectDuplicates: 0,
    observedDurationMs: nowMs() - startedAtMs,
  };
}

function injectionRequest(options) {
  const bindingHash = createHash("sha256").update(
    `${options.runId}:${options.phase}:${options.failureName}`,
  ).digest("hex");
  const idempotencyKey = `failure:${options.failureName}:${bindingHash}`;
  for (const [label, value] of Object.entries({
    runId: options.runId,
    phase: options.phase,
    failureName: options.failureName,
  })) {
    if (!boundedId(value, 128)) throw new Error(`Invalid failure ${label}`);
  }
  if (!validProfile(options.failureName, options.target, options.fault)) {
    throw new Error("Failure target and fault do not match the approved profile");
  }
  if (!Number.isInteger(options.targetConcurrency) || options.targetConcurrency < 1 ||
    options.targetConcurrency > 10_000) {
    throw new Error("Failure target concurrency is invalid");
  }
  return {
    schemaVersion: 1,
    runId: options.runId,
    phase: options.phase,
    failureName: options.failureName,
    target: options.target,
    fault: options.fault,
    targetConcurrency: options.targetConcurrency,
    scope: "run",
    maxAffectedResources: 1,
    recoveryTimeoutSeconds: options.recoveryTimeoutSeconds,
    recoveryPolicy: "automatic",
    idempotencyKey,
  };
}

async function waitForRecovery(options, request, initial, startedAtMs) {
  let current = initial;
  const deadline = startedAtMs + options.recoveryTimeoutSeconds * 1000;
  while (current.status !== "recovered" && now(options) < deadline) {
    if (current.status === "failed") {
      throw new Error("Failure controller reported terminal failure");
    }
    await abortableDelay(options.statusPollMs, options);
    current = await controllerRequest(
      options,
      `v1/failure-operations/${encodeURIComponent(initial.operationId)}`,
    );
    assertOperation(current, request, { startedAtMs, options });
    if (current.operationId !== initial.operationId) {
      throw new Error("Failure controller operation binding changed");
    }
  }
  if (current.status !== "recovered") {
    throw new Error("Timed out waiting for automatic failure recovery");
  }
  return current;
}

function assertOperation(value, request, context) {
  if (value?.schemaVersion !== 1 || !boundedId(value.operationId, 160) ||
    value.idempotencyKey !== request.idempotencyKey || value.runId !== request.runId ||
    value.phase !== request.phase || value.failureName !== request.failureName ||
    value.target !== request.target || value.fault !== request.fault ||
    value.targetConcurrency !== request.targetConcurrency ||
    value.scope !== "run" || value.maxAffectedResources !== 1 ||
    value.recoveryTimeoutSeconds !== request.recoveryTimeoutSeconds ||
    value.recoveryPolicy !== "automatic" || !operationStatuses.has(value.status)) {
    throw new Error("Failure controller response binding is invalid");
  }
  const recoveryDeadlineMs = Date.parse(value.recoveryDeadlineAt);
  const latestAllowed = context.startedAtMs +
    context.options.recoveryTimeoutSeconds * 1000 + 5_000;
  if (!Number.isFinite(recoveryDeadlineMs) || recoveryDeadlineMs > latestAllowed ||
    (value.status !== "recovered" && recoveryDeadlineMs < now(context.options) - 5_000)) {
    throw new Error("Failure controller automatic recovery deadline is invalid");
  }
  if (value.status === "recovered") assertRecovered(value, context);
}

function assertRecovered(value, context) {
  const injectionAtMs = Date.parse(value.injectionObservedAt);
  const recoveredAtMs = Date.parse(value.recoveredAt);
  const clockNow = now(context.options);
  if (!Number.isFinite(injectionAtMs) || !Number.isFinite(recoveredAtMs) ||
    injectionAtMs < context.startedAtMs - 300_000 ||
    recoveredAtMs < injectionAtMs || recoveredAtMs > clockNow + 5_000) {
    throw new Error("Failure controller recovery timeline is invalid");
  }
}

async function controllerRequest(options, path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs);
  const aborted = () => controller.abort(options.signal.reason);
  options.signal?.addEventListener("abort", aborted, { once: true });
  try {
    const response = await (options.fetchFn ?? fetch)(
      new URL(path, options.controllerUrl),
      {
        method: init.method ?? "GET",
        redirect: "error",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${options.token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(init.idempotencyKey
            ? { "idempotency-key": init.idempotencyKey }
            : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      },
    );
    const text = await response.text();
    if (Buffer.byteLength(text) > 262_144) {
      throw new Error("Failure controller response is too large");
    }
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new Error("Failure controller returned invalid JSON");
    }
    if (!response.ok) {
      throw new Error(`Failure controller returned HTTP ${response.status}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", aborted);
  }
}

function evidence(value) {
  if (!Array.isArray(value) || value.length > 64 || value.some((item) =>
    typeof item !== "string" || item.length < 1 || Buffer.byteLength(item) > 512
  )) return [];
  return [...new Set(value.map((item) => redactPhoneNumbers(item)))];
}

export function validProfile(name, target, fault) {
  return (name === "translation_worker_sigkill" && target === "translation-worker" &&
      fault === "sigkill") ||
    (name === "model_provider_timeout" && target === "model-provider" &&
      fault === "timeout") ||
    (name === "livekit_node_drain" && target === "livekit" &&
      fault === "node-drain");
}

function boundedId(value, maximum) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]+$/.test(value) &&
    Buffer.byteLength(value) <= maximum;
}

function now(options) { return (options.nowMs ?? Date.now)(); }

function abortableDelay(ms, options) {
  const sleep = options.sleep ?? ((delay) =>
    new Promise((resolve) => setTimeout(resolve, delay)));
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new Error("Failure injection aborted");
  }
  if (!options.signal) return sleep(ms);
  return new Promise((resolve, reject) => {
    const aborted = () => reject(
      options.signal.reason ?? new Error("Failure injection aborted"),
    );
    options.signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(sleep(ms)).then(resolve, reject).finally(() =>
      options.signal.removeEventListener("abort", aborted));
  });
}
