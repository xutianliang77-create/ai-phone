import type {
  AirDeviceCallDto,
  AirDeviceTrackAdmissionRequest,
  AirDeviceUplinkSource,
} from "@translation/contracts";
import { findAgentCallDraftByCallReference } from
  "../agent-calls/agent-calls-runtime.repository.js";
import { findCallLink } from "../call-links/call-links.service.js";
import { findSession } from "../sessions/sessions-runtime.repository.js";

type BoundAdmission = AirDeviceTrackAdmissionRequest & {
  uplinkSource: AirDeviceUplinkSource;
};

interface AirCallStatusReader {
  findCurrentCallStatus(input: {
    communicationSessionId: string;
    deviceId: string;
    leaseId: string;
    fencingToken: number;
    callGeneration: number;
  }): Promise<AirDeviceCallDto | null>;
}

interface SourceAuthorizationDependencies {
  findCallLink(communicationSessionId: string): Promise<{
    roomName: string;
    purpose: "human_call" | "voice_agent";
  } | null>;
  findSession(communicationSessionId: string): Promise<{
    callLegs?: Array<{
      status: string;
      participantIdentity: string;
      participantRole: string;
    }>;
  } | null>;
  findAgentCallDraftByCallReference(input: {
    callId?: string;
    providerCallId?: string;
  }): Promise<{
    status: string;
    executionProvider?: string;
    providerOperationId?: string;
    takeoverReadyAt?: string;
    takeoverResolvedAt?: string;
    takeoverParticipantIdentity?: string;
  } | null>;
}

export class DeviceCallMediaAdmissionConflict extends Error {
  constructor(readonly reason: string) {
    super("Air device media source is not authorized");
    this.name = "DeviceCallMediaAdmissionConflict";
  }
}

export function createAirDeviceUplinkSourceAuthorizer(
  airCalls: AirCallStatusReader,
  dependencies: SourceAuthorizationDependencies = {
    findCallLink,
    findSession,
    findAgentCallDraftByCallReference,
  },
) {
  return {
    async assertAuthorized(input: BoundAdmission) {
      const [call, session, airCall] = await Promise.all([
        dependencies.findCallLink(input.communicationSessionId),
        dependencies.findSession(input.communicationSessionId),
        airCalls.findCurrentCallStatus(input),
      ]);
      requireMedia(call && session && airCall, "call_binding_missing");
      requireMedia(call!.roomName === input.roomName, "room_mismatch");
      requireMedia(airCall!.carrierState === "connected", "carrier_not_connected");

      const expectedMediaPolicy = call!.purpose === "voice_agent"
        ? "agent_monitored"
        : "translation_isolated";
      requireMedia(
        airCall!.mediaPolicy === expectedMediaPolicy,
        "media_policy_mismatch",
      );

      const activeLeg = session!.callLegs?.find((leg) =>
        leg.status === "active" &&
        leg.participantIdentity === input.publisherIdentity
      );
      if (input.uplinkSource === "translated_tts") {
        requireMedia(activeLeg?.participantRole === "worker", "worker_leg_inactive");
        if (call!.purpose !== "voice_agent") return;
        const draft = await dependencies.findAgentCallDraftByCallReference({
          callId: input.communicationSessionId,
          providerCallId: airCall!.providerCallId,
        });
        requireMedia(draft?.executionProvider === "air780_volte", "agent_call_missing");
        requireMedia(
          !(draft!.takeoverReadyAt && draft!.takeoverResolvedAt),
          "takeover_already_accepted",
        );
        return;
      }

      requireMedia(call!.purpose === "voice_agent", "not_voice_agent_call");
      requireMedia(activeLeg?.participantRole === "host", "host_leg_inactive");
      const draft = await dependencies.findAgentCallDraftByCallReference({
        callId: input.communicationSessionId,
        providerCallId: airCall!.providerCallId,
      });
      requireMedia(draft?.executionProvider === "air780_volte", "agent_call_missing");
      requireMedia(draft!.status === "takeover_requested", "takeover_not_active");
      requireMedia(Boolean(draft!.takeoverReadyAt), "takeover_not_ready");
      requireMedia(Boolean(draft!.takeoverResolvedAt), "takeover_not_resolved");
      requireMedia(
        draft!.takeoverParticipantIdentity === input.publisherIdentity,
        "takeover_host_mismatch",
      );
      requireMedia(
        draft!.providerOperationId === airCall!.providerOperationId,
        "provider_operation_mismatch",
      );
    },
  };
}

function requireMedia(
  condition: unknown,
  reason: string,
): asserts condition {
  if (!condition) throw new DeviceCallMediaAdmissionConflict(reason);
}
