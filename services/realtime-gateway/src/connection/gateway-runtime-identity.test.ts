import { describe, expect, it } from "vitest";
import type { RealtimeEnv } from "../config/env.js";
import {
  gatewayRuntimeIdentity,
  gatewayRuntimeIdentityIssues,
} from "./gateway-runtime-identity.js";

describe("gateway runtime identity", () => {
  it("accepts a complete candidate, source, image and config identity", () => {
    const env = identityEnv();

    expect(gatewayRuntimeIdentity(env)).toEqual({
      candidateId: "wujie-v1-candidate",
      sourceCommit: "a".repeat(40),
      sourceTree: "b".repeat(40),
      imageId: `sha256:${"c".repeat(64)}`,
      configSha256: "d".repeat(64),
      traceable: true,
    });
    expect(gatewayRuntimeIdentityIssues(env)).toEqual([]);
  });

  it("blocks explicit traceable release mode when any identity is missing", () => {
    const env = identityEnv();
    env.runtimeConfigSha256 = undefined;

    expect(gatewayRuntimeIdentity(env)?.traceable).toBe(false);
    expect(gatewayRuntimeIdentityIssues(env)).toEqual([
      "Release requires complete WUJIE_RUNTIME_* source, image, and config identity",
    ]);
  });

  it("omits identity for existing development configurations", () => {
    const env = {} as RealtimeEnv;

    expect(gatewayRuntimeIdentity(env)).toBeUndefined();
    expect(gatewayRuntimeIdentityIssues(env)).toEqual([]);
  });
});

function identityEnv() {
  return {
    runtimeCandidateId: "wujie-v1-candidate",
    runtimeSourceCommit: "a".repeat(40),
    runtimeSourceTree: "b".repeat(40),
    runtimeImageId: `sha256:${"c".repeat(64)}`,
    runtimeConfigSha256: "d".repeat(64),
    requireTraceableRuntime: true,
  } as RealtimeEnv;
}
