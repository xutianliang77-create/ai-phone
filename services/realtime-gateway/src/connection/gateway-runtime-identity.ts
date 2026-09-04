import type { RealtimeEnv } from "../config/env.js";

export interface GatewayRuntimeIdentity {
  candidateId: string;
  sourceCommit: string;
  sourceTree: string;
  imageId: string;
  configSha256: string;
  traceable: boolean;
}

export function gatewayRuntimeIdentity(
  env: RealtimeEnv,
): GatewayRuntimeIdentity | undefined {
  const configured = [
    env.runtimeCandidateId,
    env.runtimeSourceCommit,
    env.runtimeSourceTree,
    env.runtimeImageId,
    env.runtimeConfigSha256,
  ].some(Boolean);
  if (!configured) return undefined;
  const identity = {
    candidateId: env.runtimeCandidateId ?? "untraceable",
    sourceCommit: env.runtimeSourceCommit ?? "untraceable",
    sourceTree: env.runtimeSourceTree ?? "untraceable",
    imageId: env.runtimeImageId ?? "untraceable",
    configSha256: env.runtimeConfigSha256 ?? "untraceable",
  };
  return {
    ...identity,
    traceable: validCandidateId(identity.candidateId) &&
      /^[a-f0-9]{40}$/u.test(identity.sourceCommit) &&
      /^[a-f0-9]{40}$/u.test(identity.sourceTree) &&
      /^(sha256:)?[a-f0-9]{64}$/u.test(identity.imageId) &&
      /^[a-f0-9]{64}$/u.test(identity.configSha256),
  };
}

export function gatewayRuntimeIdentityIssues(env: RealtimeEnv) {
  if (!env.requireTraceableRuntime) return [];
  const identity = gatewayRuntimeIdentity(env);
  return identity?.traceable
    ? []
    : ["Release requires complete WUJIE_RUNTIME_* source, image, and config identity"];
}

function validCandidateId(value: string) {
  return value !== "untraceable" && /^[A-Za-z0-9._-]{1,96}$/u.test(value);
}
