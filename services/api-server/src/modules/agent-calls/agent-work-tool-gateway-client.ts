import { createHash } from "node:crypto";
import type { AgentWorkRecord } from "./agent-work-record.js";

export interface AgentWorkToolResult {
  summary: string;
  announcementText?: string;
  evidenceCodes: string[];
  resultHash: string;
}

export class AgentWorkToolGatewayClient {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: {
    baseUrl: string;
    secret: string;
    timeoutMs: number;
    fetchFn?: typeof fetch;
  }) {
    if (!options.baseUrl || Buffer.byteLength(options.secret) < 16 ||
      !Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 ||
      options.timeoutMs > 60_000) {
      throw new AgentWorkToolGatewayError(
        "agent_work_tool_gateway_not_configured",
        false,
      );
    }
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async execute(input: {
    work: AgentWorkRecord;
    arguments: Record<string, unknown>;
  }): Promise<AgentWorkToolResult> {
    if (input.work.toolName !== "availability_lookup" ||
      input.work.toolVersion !== "1" ||
      input.work.sideEffectScopes.length !== 1 ||
      input.work.sideEffectScopes[0] !== "external_read") {
      throw new AgentWorkToolGatewayError(
        "agent_work_tool_not_executable",
        false,
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchFn(
        `${this.options.baseUrl}/v1/agent-work/execute`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.options.secret}`,
            "x-agent-work-idempotency-key": input.work.workId,
          },
          body: JSON.stringify({
            workId: input.work.workId,
            toolName: input.work.toolName,
            toolVersion: input.work.toolVersion,
            attempt: input.work.attempt,
            arguments: input.arguments,
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new AgentWorkToolGatewayError(
          `agent_work_tool_gateway_http_${response.status}`,
          response.status === 408 || response.status === 409 ||
            response.status === 425 || response.status === 429 ||
            response.status >= 500,
        );
      }
      const value = parseResult(await readBoundedBody(response));
      return {
        ...value,
        resultHash: createHash("sha256")
          .update(stableJson(value))
          .digest("hex"),
      };
    } catch (error) {
      if (error instanceof AgentWorkToolGatewayError) throw error;
      throw new AgentWorkToolGatewayError(
        error instanceof Error && error.name === "AbortError"
          ? "agent_work_tool_gateway_timeout"
          : "agent_work_tool_gateway_unavailable",
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export class AgentWorkToolGatewayError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(code);
    this.name = "AgentWorkToolGatewayError";
  }
}

async function readBoundedBody(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > 64 * 1024) {
    throw new AgentWorkToolGatewayError(
      "agent_work_tool_gateway_response_too_large",
      false,
    );
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > 64 * 1024) {
    throw new AgentWorkToolGatewayError(
      "agent_work_tool_gateway_response_too_large",
      false,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AgentWorkToolGatewayError(
      "agent_work_tool_gateway_response_invalid",
      false,
    );
  }
}

function parseResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidResult();
  }
  const result = value as Record<string, unknown>;
  const summary = boundedText(result.summary, 800);
  const announcementText = result.announcementText === undefined
    ? undefined
    : boundedText(result.announcementText, 800);
  const evidenceCodes = Array.isArray(result.evidenceCodes) &&
      result.evidenceCodes.length <= 8
    ? result.evidenceCodes.map((item) => boundedText(item, 120))
    : null;
  if (!summary || !evidenceCodes) throw invalidResult();
  return {
    summary,
    ...(announcementText ? { announcementText } : {}),
    evidenceCodes,
  };
}

function boundedText(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim() &&
      Buffer.byteLength(value) <= maximum
    ? value.trim()
    : "";
}

function invalidResult() {
  return new AgentWorkToolGatewayError(
    "agent_work_tool_gateway_result_invalid",
    false,
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}
