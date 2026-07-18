import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import * as legacy from "./ingress.repository.js";

export async function beginExternalMediaSource(
  input: Parameters<typeof legacy.beginExternalMediaSource>[0],
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.beginExternalMediaSource(input);
  const commandId = repositoryCommandId({
    aggregateId: input.sessionId,
    operation: "external-media-source-begin",
    version: 0,
    requestHash: input.requestHash,
  });
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: input.sessionId },
    (fence) => runtime.postgres.ingress.begin({ ...input, commandId, fence }),
  );
}

export async function updateExternalMediaSource(
  input: Parameters<typeof legacy.updateExternalMediaSource>[0],
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.updateExternalMediaSource(input);
  const source = await runtime.postgres.ingress.find(input.sourceId);
  if (!source) return { status: "not_found" as const };
  const requestHash = repositoryRequestHash(input);
  const commandId = repositoryCommandId({
    aggregateId: source.sessionId,
    operation: `external-media-source-${input.status}`,
    version: input.expectedVersion ?? source.version,
    requestHash,
  });
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: source.sessionId },
    (fence) => runtime.postgres.ingress.update({
      ...input,
      sessionId: source.sessionId,
      commandId,
      requestHash,
      fence,
    }),
  );
}

export function findExternalMediaSource(sourceId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.ingress.find(sourceId)
    : Promise.resolve(legacy.findExternalMediaSource(sourceId));
}

export function findExternalMediaSourceByIngressId(ingressId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.ingress.findByIngressId(ingressId)
    : Promise.resolve(legacy.findExternalMediaSourceByIngressId(ingressId));
}

export function findExternalMediaSourceByIdempotency(
  sessionId: string,
  idempotencyKey: string,
) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.ingress.findByIdempotency(sessionId, idempotencyKey)
    : Promise.resolve(legacy.findExternalMediaSourceByIdempotency(
      sessionId,
      idempotencyKey,
    ));
}

export function listSessionExternalMediaSources(sessionId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.ingress.listSession(sessionId)
    : Promise.resolve(legacy.listSessionExternalMediaSources(sessionId));
}

export function listRecoverableExternalMediaSources() {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.ingress.listRecoverable()
    : Promise.resolve(legacy.listRecoverableExternalMediaSources());
}
