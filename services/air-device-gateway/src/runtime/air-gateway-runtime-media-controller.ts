import type { AirDeviceLiveKitParticipantEventRequest } from
  "@translation/contracts";
import type { BoundedDeviceAudioQueue } from
  "../media/device-audio-queue.js";
import type { AirDeviceBootAdmission } from
  "../device/air-device-boot-admission.js";
import type {
  AirDeviceSessionRouter,
  SessionBoundCarrierState,
} from "../device/device-session-router.js";
import { VuartFrameType, type VuartFrame } from "../device/vuart-frame.js";
import type { AirGatewayAudioPump } from "./air-gateway-audio-pump.js";
import {
  airGatewayCarrierEventRequest,
  airGatewayLiveKitEventRequest,
  type AirGatewayCarrierStateRegistry,
} from "./air-gateway-carrier-client.js";
import type { AirGatewayCarrierEventDispatcher } from
  "./air-gateway-carrier-dispatcher.js";
import type {
  AirGatewayRoomSession,
  SessionBoundLiveKitParticipantState,
} from "./air-gateway-room-session.js";
import type { AirGatewayTtsUplink } from "./air-gateway-tts-uplink.js";

export class AirGatewayRuntimeMediaController {
  private readonly counters = {
    nonConnectedDownlinkDrops: 0,
    unknownCarrierQuarantines: 0,
  };

  constructor(private readonly dependencies: {
    admission: AirDeviceBootAdmission;
    router: AirDeviceSessionRouter;
    carrier: AirGatewayCarrierStateRegistry;
    room: AirGatewayRoomSession;
    queue: BoundedDeviceAudioQueue;
    pump: AirGatewayAudioPump;
    tts: AirGatewayTtsUplink;
    carrierDispatcher: AirGatewayCarrierEventDispatcher;
    liveKitDispatcher:
      AirGatewayCarrierEventDispatcher<AirDeviceLiveKitParticipantEventRequest>;
    now: () => Date;
  }) {}

  handleFrame(frame: VuartFrame) {
    if (frame.type !== VuartFrameType.AUDIO_DOWNLINK &&
      frame.type !== VuartFrameType.CALL_STATE) return;
    const result = this.dependencies.router.route(frame);
    if (!result.accepted || result.kind !== "audio") return;
    const binding = this.dependencies.router.binding();
    if (!binding ||
      this.dependencies.carrier.reconcile(binding)?.state !== "connected") {
      this.counters.nonConnectedDownlinkDrops += 1;
      if (binding) this.dependencies.queue.discardQueuedFrames(binding.callGeneration);
      return;
    }
    this.dependencies.pump.notify();
  }

  handleCarrier(event: SessionBoundCarrierState) {
    const observedAt = this.dependencies.now();
    this.dependencies.carrier.observe(event, observedAt);
    const bootId = this.dependencies.admission.snapshot().bootId;
    if (bootId) {
      void this.dependencies.carrierDispatcher.enqueue(
        airGatewayCarrierEventRequest(event, bootId, observedAt),
      ).catch(() => undefined);
    }
    if (event.carrierState === "connected") {
      this.dependencies.pump.resume();
      this.dependencies.tts.resume(event);
    }
    if (!["disconnected", "busy", "failed", "unknown"]
      .includes(event.carrierState)) return;
    if (event.carrierState === "unknown") {
      this.counters.unknownCarrierQuarantines += 1;
    }
    this.dependencies.pump.suspend();
    this.dependencies.tts.suspend(event.callGeneration);
    this.dependencies.queue.discardQueuedFrames(event.callGeneration);
    void this.dependencies.room.clear(event).catch(() => undefined);
  }

  handleRoom(event: SessionBoundLiveKitParticipantState) {
    if (event.liveKitParticipantState === "joined" &&
      this.dependencies.carrier.reconcile(event)?.state === "connected") {
      this.dependencies.pump.resume();
      this.dependencies.tts.resume(event);
    } else {
      this.dependencies.pump.suspend();
      this.dependencies.tts.suspend(event.callGeneration);
      this.dependencies.queue.discardQueuedFrames(event.callGeneration);
    }
    const bootId = this.dependencies.admission.snapshot().bootId;
    if (bootId) {
      void this.dependencies.liveKitDispatcher.enqueue(
        airGatewayLiveKitEventRequest(event, bootId, this.dependencies.now()),
      ).catch(() => undefined);
    }
  }

  metrics() {
    return { ...this.counters };
  }
}
