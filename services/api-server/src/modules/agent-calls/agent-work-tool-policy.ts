import type {
  AgentWorkCreatePayload,
  AgentWorkPriority,
  AgentWorkRiskLevel,
  AgentWorkSideEffectScope,
} from "@translation/contracts";

export const boundedRealtimeVoiceTools = [
  "agent.work.create",
  "agent.work.cancel",
  "agent.work.status",
  "current_time",
  "memory.read",
  "memory.write",
  "permission.request",
  "permission.status",
] as const;

export interface BackgroundAgentWorkToolPolicy {
  readonly toolName: string;
  readonly toolVersion: string;
  readonly policyVersion: string;
  readonly riskLevel: AgentWorkRiskLevel;
  readonly sideEffectScopes: readonly AgentWorkSideEffectScope[];
  readonly priority: AgentWorkPriority;
  readonly maxAttempts: number;
  readonly maxRuntimeMs: number;
  readonly maxTtlMs: number;
}

const builtInBackgroundPolicies: BackgroundAgentWorkToolPolicy[] = [
  {
    toolName: "availability_lookup",
    toolVersion: "1",
    policyVersion: "availability-lookup-policy-v1",
    riskLevel: "low",
    sideEffectScopes: ["external_read"],
    priority: "normal",
    maxAttempts: 3,
    maxRuntimeMs: 30_000,
    maxTtlMs: 5 * 60_000,
  },
];

export class AgentWorkToolPolicyRegistry {
  private readonly policies = new Map<string, BackgroundAgentWorkToolPolicy>();

  constructor(policies: BackgroundAgentWorkToolPolicy[]) {
    for (const policy of policies) {
      validatePolicy(policy);
      const key = policyKey(policy.toolName, policy.toolVersion);
      if (this.policies.has(key)) {
        throw new AgentWorkToolPolicyError("duplicate_background_tool_policy");
      }
      this.policies.set(key, Object.freeze({
        ...policy,
        sideEffectScopes: Object.freeze([...policy.sideEffectScopes]),
      }));
    }
  }

  require(toolName: string, toolVersion: string) {
    const policy = this.policies.get(policyKey(toolName, toolVersion));
    if (!policy) throw new AgentWorkToolPolicyError("background_tool_not_registered");
    return policy;
  }

  assertCreatePayload(payload: AgentWorkCreatePayload, now = new Date()) {
    if (!Number.isFinite(now.getTime())) {
      throw new AgentWorkToolPolicyError("work_policy_time_invalid");
    }
    const policy = this.require(payload.toolName, payload.toolVersion);
    const exactScopes = JSON.stringify([...payload.sideEffectScopes].sort()) ===
      JSON.stringify([...policy.sideEffectScopes].sort());
    const ttlMs = Date.parse(payload.expiresAt) - now.getTime();
    if (payload.riskLevel !== policy.riskLevel || !exactScopes ||
      payload.priority !== policy.priority ||
      payload.maxAttempts < 1 || payload.maxAttempts > policy.maxAttempts ||
      payload.maxRuntimeMs < 1_000 ||
      payload.maxRuntimeMs > policy.maxRuntimeMs || ttlMs <= 0 ||
      ttlMs > policy.maxTtlMs) {
      throw new AgentWorkToolPolicyError("background_tool_policy_mismatch");
    }
    return policy;
  }
}

export const defaultAgentWorkToolPolicyRegistry =
  new AgentWorkToolPolicyRegistry(builtInBackgroundPolicies);

export class AgentWorkToolPolicyError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AgentWorkToolPolicyError";
  }
}

function policyKey(toolName: string, toolVersion: string) {
  return `${toolName}\u0000${toolVersion}`;
}

function validatePolicy(policy: BackgroundAgentWorkToolPolicy) {
  if (!policy.toolName.trim() || Buffer.byteLength(policy.toolName) > 120 ||
    !policy.toolVersion.trim() || Buffer.byteLength(policy.toolVersion) > 80 ||
    !policy.policyVersion.trim() ||
    Buffer.byteLength(policy.policyVersion) > 160 ||
    policy.sideEffectScopes.length < 1 || policy.sideEffectScopes.length > 8 ||
    new Set(policy.sideEffectScopes).size !== policy.sideEffectScopes.length ||
    (policy.sideEffectScopes.includes("none") &&
      policy.sideEffectScopes.length !== 1) ||
    !Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 ||
    policy.maxAttempts > 5 || !Number.isInteger(policy.maxRuntimeMs) ||
    policy.maxRuntimeMs < 1_000 || policy.maxRuntimeMs > 30 * 60_000 ||
    !Number.isInteger(policy.maxTtlMs) || policy.maxTtlMs < 5_000 ||
    policy.maxTtlMs > 30 * 60_000) {
    throw new AgentWorkToolPolicyError("background_tool_policy_invalid");
  }
}
