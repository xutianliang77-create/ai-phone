import { createHash } from "node:crypto";
import { llm, tool } from "@livekit/agents";
import { z } from "zod";
import type { VoiceAgentUserData } from "./runtime-tools.js";

const availabilityArgumentsSchema = z.object({
  subject: z.string().min(1).max(200),
  location: z.string().min(1).max(200).optional(),
  timeWindow: z.string().min(1).max(200).optional(),
  constraints: z.array(z.string().min(1).max(160)).max(8).default([]),
}).strict();

const permissionIdSchema = z.object({
  permissionRequestId: z.string().min(1).max(160),
}).strict();

const workIdSchema = z.object({
  workId: z.string().min(1).max(160),
}).strict();

const timeSchema = z.object({
  timeZone: z.string().min(1).max(64).optional(),
}).strict();

export function buildBackgroundWorkTools(data: VoiceAgentUserData) {
  if (!data.backgroundWorkEnabled) {
    return [] as llm.FunctionTool<any, VoiceAgentUserData, any>[];
  }
  return [
    tool<VoiceAgentUserData, typeof timeSchema>({
      name: "current_time",
      description: "Return the current time. This has no external side effect.",
      parameters: timeSchema,
      onDuplicate: "allow",
      execute: async ({ timeZone }) => currentTime(timeZone),
    }),
    tool<VoiceAgentUserData, typeof availabilityArgumentsSchema>({
      name: "permission_request",
      description: "Ask the app user for explicit permission to run one bounded background availability lookup. Never claim that approval was granted until permission_status says granted.",
      parameters: availabilityArgumentsSchema,
      onDuplicate: "allow",
      execute: async (args) => {
        const turn = requireCurrentTurn(data);
        const argumentsValue = {
          subject: args.subject,
          ...(args.location ? { location: args.location } : {}),
          ...(args.timeWindow ? { timeWindow: args.timeWindow } : {}),
          constraints: args.constraints,
        };
        const argumentsHash = hashJson(argumentsValue);
        const identity = scopedIdentity(data, turn.turnId, argumentsHash);
        const permissionRequestId = `perm_${identity.slice(0, 40)}`;
        const result = await data.api.requestWorkPermission({
          snapshot: data.snapshot,
          ticket: data.ticket,
          permissionRequestId,
          commandId: `permission_request_${identity.slice(0, 48)}`,
          turn,
          toolName: "availability_lookup",
          toolVersion: "1",
          submissionKey: `availability:${identity}`,
          arguments: argumentsValue,
          argumentsHash,
          reasonCode: "availability_lookup_requested",
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        });
        data.interaction.setPermissionPromptActive(
          result.permission.status === "pending",
        );
        return {
          permissionRequestId,
          status: result.permission.status,
          requiresAppApproval: result.permission.status === "pending",
        };
      },
    }),
    tool<VoiceAgentUserData, typeof permissionIdSchema>({
      name: "permission_status",
      description: "Check an existing background-work permission request.",
      parameters: permissionIdSchema,
      onDuplicate: "allow",
      execute: async ({ permissionRequestId }) => {
        const result = await data.api.workPermissionStatus({
          snapshot: data.snapshot,
          ticket: data.ticket,
          permissionRequestId,
        });
        data.interaction.setPermissionPromptActive(
          result.permission.status === "pending",
        );
        return {
          permissionRequestId,
          status: result.permission.status,
          ...(result.permission.authorizationSnapshotId
            ? { authorizationSnapshotId:
                result.permission.authorizationSnapshotId }
            : {}),
        };
      },
    }),
    tool<VoiceAgentUserData, typeof permissionIdSchema>({
      name: "agent_work_create",
      description: "Create the approved durable background work. Call only after permission_status returned granted.",
      parameters: permissionIdSchema,
      onDuplicate: "allow",
      execute: async ({ permissionRequestId }) => {
        const permission = (await data.api.workPermissionStatus({
          snapshot: data.snapshot,
          ticket: data.ticket,
          permissionRequestId,
        })).permission;
        data.interaction.setPermissionPromptActive(
          permission.status === "pending",
        );
        if (permission.status !== "granted" ||
          !permission.authorizationSnapshotId) {
          throw new Error("background_work_permission_not_granted");
        }
        const current = requireCurrentTurn(data);
        if (current.turnId !== permission.turnId ||
          current.turnGeneration !== permission.turnGeneration ||
          current.dispatchGeneration !== permission.dispatchGeneration) {
          throw new Error("background_work_permission_stale");
        }
        const identity = createHash("sha256")
          .update(permissionRequestId)
          .digest("hex");
        const workId = `work_${identity.slice(0, 40)}`;
        const result = await data.api.createWork({
          snapshot: data.snapshot,
          ticket: data.ticket,
          workId,
          commandId: `agent_work_create_${identity.slice(0, 48)}`,
          turnId: permission.turnId,
          permissionRequestId,
          authorizationSnapshotId: permission.authorizationSnapshotId,
        });
        return {
          workId,
          status: result.work.status,
          accepted: true,
        };
      },
    }),
    tool<VoiceAgentUserData, typeof workIdSchema>({
      name: "agent_work_status",
      description: "Check durable background work status without waiting for it.",
      parameters: workIdSchema,
      onDuplicate: "allow",
      execute: async ({ workId }) => {
        const result = await data.api.workStatus({
          snapshot: data.snapshot,
          ticket: data.ticket,
          workId,
        });
        return {
          workId,
          status: result.work.status,
          attempt: result.work.attempt,
          failureCode: result.work.failureCode,
        };
      },
    }),
    tool<VoiceAgentUserData, typeof workIdSchema>({
      name: "agent_work_cancel",
      description: "Request confirmation-based cancellation of durable background work.",
      parameters: workIdSchema,
      onDuplicate: "allow",
      execute: async ({ workId }) => {
        const work = (await data.api.workStatus({
          snapshot: data.snapshot,
          ticket: data.ticket,
          workId,
        })).work;
        const identity = createHash("sha256")
          .update(`${workId}:user_cancelled`)
          .digest("hex");
        const result = await data.api.cancelWork({
          snapshot: data.snapshot,
          ticket: data.ticket,
          workId,
          commandId: `agent_work_cancel_${identity.slice(0, 48)}`,
          payload: {
            reason: "user_cancelled",
            turnGeneration: work.turnGeneration,
            dispatchGeneration: work.dispatchGeneration,
          },
        });
        return { workId, status: result.work.status };
      },
    }),
  ] satisfies llm.FunctionTool<any, VoiceAgentUserData, any>[];
}

function requireCurrentTurn(data: VoiceAgentUserData) {
  if (!data.currentTurn || data.currentTurn.state !== "active" ||
    !data.currentTurn.explicitInstructionEvidenceHash) {
    throw new Error("background_work_current_turn_unavailable");
  }
  return data.currentTurn;
}

function scopedIdentity(
  data: VoiceAgentUserData,
  turnId: string,
  argumentsHash: string,
) {
  return createHash("sha256").update([
    data.snapshot.sessionId,
    data.snapshot.run.id,
    turnId,
    argumentsHash,
  ].join("\u0000")).digest("hex");
}

function hashJson(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function currentTime(timeZone?: string) {
  const now = new Date();
  if (!timeZone) return { iso8601: now.toISOString(), timeZone: "UTC" };
  try {
    return {
      iso8601: now.toISOString(),
      timeZone,
      localized: new Intl.DateTimeFormat("en-CA", {
        timeZone,
        dateStyle: "full",
        timeStyle: "long",
      }).format(now),
    };
  } catch {
    throw new Error("current_time_zone_invalid");
  }
}
