import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";

describe("agent call worker routes", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureEnv();
    getStoreSnapshot().agentCallDrafts = [];
    configureAgentExecutionEnv();
  });

  afterEach(() => restoreEnv(previousEnv));

  it("protects atomic claims with the internal secret", async () => {
    const app = await buildApp();
    const rejected = await app.inject({
      method: "POST",
      url: "/internal/ai-calling-agent/drafts/claims",
      payload: { workerId: "worker-1", limit: 5 },
    });
    await app.close();

    expect(rejected.statusCode).toBe(401);
    expect(rejected.json().error.code).toBe("internal_error");
  });

  it("atomically claims only queued drafts for one worker", async () => {
    const app = await buildApp();
    const firstId = await createQueuedDraft(app, "预约下午三点洗牙");
    await createAuthorizedDraft(app, "咨询营业时间");
    const list = await app.inject({
      method: "POST",
      url: "/internal/ai-calling-agent/drafts/claims",
      headers: { authorization: "Bearer internal-secret-for-agent" },
      payload: { workerId: "worker-1", limit: 5 },
    });
    await app.close();

    expect(list.statusCode).toBe(200);
    expect(list.json().claims).toHaveLength(1);
    expect(list.json().claims[0]).toMatchObject({
      workerId: "worker-1",
      attempt: 1,
      dialIdempotencyKey: expect.any(String),
      draft: {
        id: firstId,
        status: "dispatching",
        targetPhone: "13800138000",
      },
    });
    expect(list.json().claims[0].draft.userId).toBeUndefined();
    expect(list.json().claims[0].draft.workerLeaseTokenHash).toBeUndefined();
  });
});

const envKeys = [
  "AGENT_CALL_WORKER_ENABLED",
  "AGENT_CALL_PROVIDER_ADAPTER",
  "AGENT_CALL_WORKER_LEASE_SECONDS",
  "AGENT_CALL_RECONCILIATION_TIMEOUT_SECONDS",
  "PSTN_PROVIDER_IDEMPOTENCY_GUARANTEED",
  "CALL_PROVIDER_POLICY",
  "INTERNAL_API_SECRET",
  "PSTN_PROVIDER",
  "PSTN_ACCOUNT_ID",
  "PSTN_API_KEY",
  "PSTN_WEBHOOK_BASE_URL",
  "PSTN_WEBHOOK_SECRET",
  "PSTN_CONSENT_PROMPT_VERSION",
  "PSTN_RECORDING_DISCLOSURE_ENABLED",
  "PSTN_MAX_CALL_MINUTES",
];

async function createQueuedDraft(
  app: Awaited<ReturnType<typeof buildApp>>,
  objective: string,
) {
  const draftId = await createAuthorizedDraft(app, objective);
  await app.inject({
    method: "POST",
    url: `/ai-calling-agent/drafts/${draftId}/start`,
    payload: { consentPromptVersion: "cn-agent-v1" },
  });
  return draftId;
}

async function createAuthorizedDraft(
  app: Awaited<ReturnType<typeof buildApp>>,
  objective: string,
) {
  const created = await app.inject({
    method: "POST",
    url: "/ai-calling-agent/drafts",
    payload: {
      scenario: "booking",
      objective,
      targetPhone: "13800138000",
    },
  });
  const draftId = created.json().draft.id as string;
  await app.inject({
    method: "POST",
    url: `/ai-calling-agent/drafts/${draftId}/authorize`,
    payload: { userConfirmed: true, consentPromptVersion: "cn-agent-v1" },
  });
  return draftId;
}

function configureAgentExecutionEnv() {
  process.env.AGENT_CALL_WORKER_ENABLED = "true";
  process.env.AGENT_CALL_PROVIDER_ADAPTER = "pstn_http";
  process.env.AGENT_CALL_WORKER_LEASE_SECONDS = "45";
  process.env.AGENT_CALL_RECONCILIATION_TIMEOUT_SECONDS = "7200";
  process.env.PSTN_PROVIDER_IDEMPOTENCY_GUARANTEED = "true";
  process.env.CALL_PROVIDER_POLICY = "domestic_pstn_bridge";
  process.env.INTERNAL_API_SECRET = "internal-secret-for-agent";
  process.env.PSTN_PROVIDER = "domestic_bridge";
  process.env.PSTN_ACCOUNT_ID = "pstn-account";
  process.env.PSTN_API_KEY = "pstn-api-key";
  process.env.PSTN_WEBHOOK_BASE_URL = "https://calls.qkxy.cn";
  process.env.PSTN_WEBHOOK_SECRET = "12345678901234567890123456789012";
  process.env.PSTN_CONSENT_PROMPT_VERSION = "cn-agent-v1";
  process.env.PSTN_RECORDING_DISCLOSURE_ENABLED = "true";
  process.env.PSTN_MAX_CALL_MINUTES = "30";
}

function captureEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const key of envKeys) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
