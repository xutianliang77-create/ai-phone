import type { PoolClient } from "pg";
import type {
  AirDeviceCallDto,
  AirDeviceCarrierEventRequest,
  AirDeviceLiveKitParticipantEventRequest,
} from "@translation/contracts";
import type { PostgresOutboxEnqueueInput } from
  "../../infrastructure/storage/postgres-reliable-outbox.repository.js";
import {
  airDeviceCallFromRow,
  DeviceCallBindingConflict,
  type AirDeviceCallRow,
} from "./postgres-air-device-calls.repository.js";

type CarrierState = AirDeviceCallDto["carrierState"];

interface ReliableInbox {
  claim(input: {
    eventId: string;
    sessionId: string;
    eventType: string;
    payload: unknown;
    claimOwner: string;
    leaseSeconds: number;
  }): Promise<{ duplicate: boolean; result: unknown }>;
  completeClaim(input: {
    eventId: string;
    claimOwner: string;
    result: AirDeviceCallDto;
    beforeComplete: (
      client: Pick<PoolClient, "query">,
    ) => Promise<void>;
  }): Promise<unknown>;
  abandon(eventId: string, claimOwner: string): Promise<unknown>;
}

interface ReliableOutbox {
  enqueue(
    client: Pick<PoolClient, "query">,
    event: PostgresOutboxEnqueueInput,
  ): Promise<unknown>;
}

export class PostgresAirDeviceCallEvents {
  constructor(private readonly dependencies: {
    inbox: ReliableInbox;
    outbox: ReliableOutbox;
  }) {}

  async processCarrierEvent(input: AirDeviceCarrierEventRequest & {
    claimOwner: string;
  }): Promise<AirDeviceCallDto> {
    validateEvent(input);
    const eventType = `device.call.${input.carrierState}`;
    const claim = await this.dependencies.inbox.claim({
      eventId: input.eventId,
      sessionId: input.communicationSessionId,
      eventType,
      payload: input,
      claimOwner: input.claimOwner,
      leaseSeconds: 30,
    });
    if (claim.duplicate) return requireCallDto(claim.result);

    const result = {} as AirDeviceCallDto;
    try {
      await this.dependencies.inbox.completeClaim({
        eventId: input.eventId,
        claimOwner: input.claimOwner,
        result,
        beforeComplete: async (client) => {
          const selected = await client.query<AirDeviceCallRow>(`
            SELECT * FROM ai_phone.air_device_calls
            WHERE provider_call_id = $1 AND communication_session_id = $2
              AND device_id = $3 AND lease_id = $4 AND fencing_token = $5
              AND call_generation = $6
              AND ai_phone.air_device_lease_is_current($3, $4, $5)
            FOR UPDATE
          `, [input.providerCallId, input.communicationSessionId,
            input.deviceId, input.leaseId, input.fencingToken,
            input.callGeneration]);
          const currentRow = selected.rows[0];
          if (!currentRow || !canTransition(
            currentRow.carrier_state,
            input.carrierState,
          ) || !isNextSequence(
            currentRow.carrier_event_sequence,
            input.eventSequence,
          )) throw new DeviceCallBindingConflict();
          const current = airDeviceCallFromRow(currentRow);
          const updated = await client.query<AirDeviceCallRow>(`
            UPDATE ai_phone.air_device_calls
            SET carrier_state = $1, carrier_event_sequence = $2,
              version = version + 1,
              connected_at = CASE WHEN $1 = 'connected'
                THEN COALESCE(connected_at, $3::timestamptz)
                ELSE connected_at END,
              ended_at = CASE WHEN $1 IN ('disconnected', 'busy', 'failed')
                THEN COALESCE(ended_at, $3::timestamptz)
                ELSE ended_at END,
              updated_at = $3::timestamptz
            WHERE provider_call_id = $4 AND version = $5
            RETURNING *
          `, [input.carrierState, input.eventSequence, input.occurredAt,
            input.providerCallId, current.version]);
          const nextRow = updated.rows[0];
          if (!nextRow) throw new DeviceCallBindingConflict();
          const next = airDeviceCallFromRow(nextRow);
          Object.assign(result, next);
          await this.dependencies.outbox.enqueue(client, {
            id: `air-call-event-${input.eventId}`,
            idempotencyKey: `air-call-event-${input.eventId}`,
            sessionId: input.communicationSessionId,
            aggregateVersion: next.version,
            sequence: next.version,
            eventType,
            eventVersion: 1,
            payload: {
              call: next,
              carrierCause: input.carrierCause,
              eventSequence: input.eventSequence,
              occurredAt: input.occurredAt,
            },
          });
        },
      });
      return requireCallDto(result);
    } catch (error) {
      await this.dependencies.inbox.abandon(input.eventId, input.claimOwner)
        .catch(() => undefined);
      throw error;
    }
  }

  async processLiveKitParticipantEvent(
    input: AirDeviceLiveKitParticipantEventRequest & { claimOwner: string },
  ): Promise<AirDeviceCallDto> {
    validateLiveKitEvent(input);
    const eventType = `device.livekit.${input.liveKitParticipantState}`;
    const claim = await this.dependencies.inbox.claim({
      eventId: input.eventId,
      sessionId: input.communicationSessionId,
      eventType,
      payload: input,
      claimOwner: input.claimOwner,
      leaseSeconds: 30,
    });
    if (claim.duplicate) return requireCallDto(claim.result);

    const result = {} as AirDeviceCallDto;
    try {
      await this.dependencies.inbox.completeClaim({
        eventId: input.eventId,
        claimOwner: input.claimOwner,
        result,
        beforeComplete: async (client) => {
          const selected = await client.query<AirDeviceCallRow>(`
            SELECT * FROM ai_phone.air_device_calls
            WHERE provider_call_id = $1 AND communication_session_id = $2
              AND device_id = $3 AND lease_id = $4 AND fencing_token = $5
              AND call_generation = $6
              AND (ai_phone.air_device_lease_is_current($3, $4, $5)
                OR ($7 = 'disconnected' AND carrier_state IN (
                  'disconnected', 'busy', 'failed'
                )))
            FOR UPDATE
          `, [input.providerCallId, input.communicationSessionId,
            input.deviceId, input.leaseId, input.fencingToken,
            input.callGeneration, input.liveKitParticipantState]);
          const currentRow = selected.rows[0];
          if (!currentRow || !canTransitionLiveKit(
            currentRow.livekit_participant_state,
            input.liveKitParticipantState,
          ) || !isNextSequence(
            currentRow.livekit_event_sequence,
            input.eventSequence,
          )) throw new DeviceCallBindingConflict();
          const current = airDeviceCallFromRow(currentRow);
          const updated = await client.query<AirDeviceCallRow>(`
            UPDATE ai_phone.air_device_calls
            SET livekit_participant_state = $1, livekit_event_sequence = $2,
              version = version + 1, updated_at = $3::timestamptz
            WHERE provider_call_id = $4 AND version = $5
            RETURNING *
          `, [input.liveKitParticipantState, input.eventSequence,
            input.occurredAt, input.providerCallId, current.version]);
          const nextRow = updated.rows[0];
          if (!nextRow) throw new DeviceCallBindingConflict();
          const next = airDeviceCallFromRow(nextRow);
          Object.assign(result, next);
          await this.dependencies.outbox.enqueue(client, {
            id: `air-livekit-event-${input.eventId}`,
            idempotencyKey: `air-livekit-event-${input.eventId}`,
            sessionId: input.communicationSessionId,
            aggregateVersion: next.version,
            sequence: next.version,
            eventType,
            eventVersion: 1,
            payload: {
              call: next,
              eventSequence: input.eventSequence,
              occurredAt: input.occurredAt,
            },
          });
        },
      });
      return requireCallDto(result);
    } catch (error) {
      await this.dependencies.inbox.abandon(input.eventId, input.claimOwner)
        .catch(() => undefined);
      throw error;
    }
  }
}

function canTransition(current: CarrierState, next: CarrierState) {
  if (current === next) return true;
  if (current === "dialing") {
    return ["ringing", "connected", "disconnected", "busy", "failed", "unknown"]
      .includes(next);
  }
  if (current === "ringing") {
    return ["connected", "disconnected", "busy", "failed", "unknown"]
      .includes(next);
  }
  if (current === "connected") {
    return ["disconnected", "failed", "unknown"].includes(next);
  }
  return current === "unknown" &&
    ["ringing", "connected", "disconnected", "busy", "failed"].includes(next);
}

function canTransitionLiveKit(
  current: AirDeviceCallDto["liveKitParticipantState"],
  next: AirDeviceCallDto["liveKitParticipantState"],
) {
  if (current === next) return true;
  if (current === "absent") return ["joining", "joined", "disconnected"].includes(next);
  if (current === "joining") return ["joined", "disconnected"].includes(next);
  if (current === "joined") return ["reconnecting", "disconnected"].includes(next);
  return current === "reconnecting" && ["joined", "disconnected"].includes(next);
}

function isNextSequence(current: string, next: number) {
  const value = Number(current);
  return Number.isSafeInteger(value) && next > value;
}

function validateEvent(input: AirDeviceCarrierEventRequest & {
  claimOwner: string;
}) {
  const bounded = (value: string, maximum: number) =>
    value.trim().length > 0 && Buffer.byteLength(value) <= maximum;
  if (!bounded(input.eventId, 200) || !bounded(input.claimOwner, 200) ||
    input.claimOwner.length < 8 ||
    !bounded(input.communicationSessionId, 160) ||
    !bounded(input.providerCallId, 200) || !bounded(input.deviceId, 128) ||
    !bounded(input.leaseId, 128) || !Number.isSafeInteger(input.fencingToken) ||
    input.fencingToken < 1 || !Number.isInteger(input.callGeneration) ||
    input.callGeneration < 0 || input.callGeneration > 0xffffffff ||
    !Number.isInteger(input.eventSequence) || input.eventSequence < 0 ||
    input.eventSequence > 0xffffffff ||
    !validCarrierStateCause(input.carrierState, input.carrierCause) ||
    !Number.isFinite(Date.parse(input.occurredAt))) {
    throw new Error("Invalid Air device carrier event");
  }
}

function validateLiveKitEvent(input: AirDeviceLiveKitParticipantEventRequest & {
  claimOwner: string;
}) {
  const bounded = (value: string, maximum: number) =>
    value.trim().length > 0 && Buffer.byteLength(value) <= maximum;
  if (!bounded(input.eventId, 200) || !bounded(input.claimOwner, 200) ||
    input.claimOwner.length < 8 ||
    !bounded(input.communicationSessionId, 160) ||
    !bounded(input.providerCallId, 200) || !bounded(input.deviceId, 128) ||
    !bounded(input.leaseId, 128) || !Number.isSafeInteger(input.fencingToken) ||
    input.fencingToken < 1 || !Number.isInteger(input.callGeneration) ||
    input.callGeneration < 0 || input.callGeneration > 0xffffffff ||
    !Number.isSafeInteger(input.eventSequence) || input.eventSequence < 0 ||
    !["absent", "joining", "joined", "reconnecting", "disconnected"]
      .includes(input.liveKitParticipantState) ||
    !Number.isFinite(Date.parse(input.occurredAt))) {
    throw new Error("Invalid Air device LiveKit event");
  }
}

function validCarrierStateCause(
  state: AirDeviceCarrierEventRequest["carrierState"],
  cause: AirDeviceCarrierEventRequest["carrierCause"],
) {
  const allowed: Record<AirDeviceCarrierEventRequest["carrierState"],
    AirDeviceCarrierEventRequest["carrierCause"][]> = {
    dialing: ["none"],
    ringing: ["none"],
    connected: ["none"],
    disconnected: ["local_hangup", "remote_hangup", "no_answer", "rejected",
      "unknown"],
    busy: ["busy"],
    failed: ["network_error", "device_error", "unknown"],
    unknown: ["unknown"],
  };
  return allowed[state]?.includes(cause) ?? false;
}

function requireCallDto(value: unknown): AirDeviceCallDto {
  const call = value as Partial<AirDeviceCallDto> | null;
  if (!call || !call.providerCallId || !call.communicationSessionId ||
    !call.providerOperationId || !call.deviceId || !call.leaseId ||
    !Number.isSafeInteger(call.fencingToken) ||
    !Number.isSafeInteger(call.callGeneration) ||
    !Number.isSafeInteger(call.version) || !call.carrierState ||
    !call.liveKitParticipantState) {
    throw new Error("Invalid Air device call event result");
  }
  return call as AirDeviceCallDto;
}
