import { tool } from "@livekit/agents";
import type { Room } from "@livekit/rtc-node";
import {
  sipDtmfCode,
  type VoiceAgentRuntimeSnapshotDto,
  type VoiceAgentStructuredResultDto,
} from "@translation/contracts";
import { z } from "zod";
import type { VoiceAgentRuntimeApiClient } from "./runtime-api-client.js";
import type { VoiceAgentDispatchTicket } from "./runtime-ticket.js";

export interface VoiceAgentUserData {
  api: VoiceAgentRuntimeApiClient;
  ticket: VoiceAgentDispatchTicket;
  snapshot: VoiceAgentRuntimeSnapshotDto;
  room: Room;
  resultReported: boolean;
  takeoverRequested: boolean;
}

const dtmfSchema = z.object({
  digit: z.string().regex(/^[0-9*#A-D]$/),
  reason: z.string().min(1).max(120),
}).strict();

const takeoverSchema = z.object({
  reason: z.string().min(1).max(200),
}).strict();

const resultSchema = z.object({
  outcome: z.enum(["completed", "partial", "unresolved", "failed"]),
  summary: z.string().min(1).max(800),
  evidence: z.array(z.string().min(1).max(300)).max(8),
  unresolvedItems: z.array(z.string().min(1).max(300)).max(8),
  nextStep: z.string().min(1).max(300).optional(),
}).strict();

export function buildVoiceAgentTools(data: VoiceAgentUserData) {
  return [
    tool<VoiceAgentUserData, typeof dtmfSchema>({
      name: "send_dtmf",
      description: "Press exactly one IVR keypad digit after the IVR asks for it.",
      parameters: dtmfSchema,
      onDuplicate: "reject",
      execute: async (args, options) => {
        const authorization = await data.api.authorizeTool({
          snapshot: data.snapshot,
          ticket: data.ticket,
          toolName: "send_dtmf",
          toolCallId: options.toolCallId,
          idempotencyKey: `${data.snapshot.run.id}:${options.toolCallId}`,
          arguments: args,
        });
        try {
          const localParticipant = data.room.localParticipant;
          if (!localParticipant) throw new Error("Voice Agent is not connected");
          await localParticipant.publishDtmf(
            sipDtmfCode(args.digit),
            args.digit,
          );
          await data.api.completeTool({
            snapshot: data.snapshot,
            ticket: data.ticket,
            executionId: authorization.executionId,
            status: "succeeded",
            resultSummary: `DTMF ${args.digit} sent`,
          });
          return { pressed: args.digit };
        } catch (error) {
          await data.api.completeTool({
            snapshot: data.snapshot,
            ticket: data.ticket,
            executionId: authorization.executionId,
            status: "failed",
            resultSummary: error instanceof Error ? error.name : "dtmf_failed",
          }).catch(() => {});
          throw error;
        }
      },
    }),
    tool<VoiceAgentUserData, typeof takeoverSchema>({
      name: "request_human_takeover",
      description: "Stop autonomous work and request a human when risk or uncertainty is high.",
      parameters: takeoverSchema,
      onDuplicate: "reject",
      execute: async (args, options) => {
        const authorization = await data.api.authorizeTool({
          snapshot: data.snapshot,
          ticket: data.ticket,
          toolName: "request_takeover",
          toolCallId: options.toolCallId,
          idempotencyKey: `${data.snapshot.run.id}:${options.toolCallId}`,
          arguments: args,
        });
        data.takeoverRequested = true;
        await data.api.completeTool({
          snapshot: data.snapshot,
          ticket: data.ticket,
          executionId: authorization.executionId,
          status: "succeeded",
          resultSummary: "Human takeover requested",
        });
        return { takeoverRequested: true };
      },
    }),
    tool<VoiceAgentUserData, typeof resultSchema>({
      name: "record_task_result",
      description: "Record the final structured task result. Never invent evidence.",
      parameters: resultSchema,
      onDuplicate: "reject",
      execute: async (args) => {
        if (data.resultReported) return { recorded: true, replayed: true };
        await data.api.event({
          snapshot: data.snapshot,
          ticket: data.ticket,
          event: "structured_result",
          result: args as VoiceAgentStructuredResultDto,
        });
        await data.api.hangup({
          snapshot: data.snapshot,
          ticket: data.ticket,
          reason: "task_finished",
        });
        data.resultReported = true;
        return { recorded: true };
      },
    }),
  ];
}
