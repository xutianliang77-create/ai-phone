import type { AddressInfo } from "node:net";
import type {
  AirDeviceCarrierEventRequest,
  AirDeviceHeartbeatRequest,
  AirDeviceLiveKitParticipantEventRequest,
  AirDeviceTrackAdmissionDto,
  AirDeviceTrackAdmissionRequest,
} from "@translation/contracts";
import type { AirDeviceRoomClient } from
  "../media/livekit-device-participant.js";
import { BoundedDeviceAudioQueue } from "../media/device-audio-queue.js";
import { AirDeviceBootAdmission, type AirDeviceBootAdmissionSnapshot } from "../device/air-device-boot-admission.js";
import { AirDeviceSessionRouter, type AirDeviceSessionBinding } from "../device/device-session-router.js";
import type { SerialTransport } from "../device/serial-transport.js";
import { VuartFrameType } from "../device/vuart-frame.js";
import { VuartSerialFrameTransport } from "../device/vuart-serial-frame-transport.js";
import { VuartV1PayloadDecoder } from "../device/vuart-v1-payload.js";
import { VuartV1Capability } from "../device/vuart-v1-command-payload.js";
import { AirDeviceGatewayCommandIngress } from
  "../device/vuart-v1-command-ingress.js";
import { VuartV1SerialCommandExchange } from
  "../device/vuart-v1-serial-command-exchange.js";
import type { AirGatewayDaemonConfig } from "./air-gateway-config.js";
import { AirGatewayCarrierEventDispatcher } from "./air-gateway-carrier-dispatcher.js";
import {
  airGatewayCarrierEventRequest,
  airGatewayHeartbeatRequest,
  airGatewayLiveKitEventRequest,
  AirGatewayCarrierStateRegistry,
} from "./air-gateway-carrier-client.js";
import { AirGatewayCommandService } from "./air-gateway-command-service.js";
import type { AirGatewayCommandLedger } from "./air-gateway-command-ledger.js";
import { FileAirGatewayCommandLedger } from "./file-air-gateway-command-ledger.js";
import { createAirGatewayHttpServer } from "./air-gateway-http-server.js";
import { AirGatewayAudioPump } from "./air-gateway-audio-pump.js";
import { AirGatewayRoomSession, type SessionBoundLiveKitParticipantState } from "./air-gateway-room-session.js";
import {
  bindingOf,
  createAirGatewayEventOutboxes,
  createUint32SequenceAllocator,
  sameSessionBinding,
  type AirGatewayEventOutboxes,
} from "./air-device-gateway-runtime-support.js";
import { AirGatewayTtsUplink } from "./air-gateway-tts-uplink.js";
import { SerialReconnectSupervisor } from "./serial-reconnect-supervisor.js";

export class AirDeviceGatewayRuntime {
  private readonly frames: VuartSerialFrameTransport;
  private readonly audioQueue: BoundedDeviceAudioQueue;
  private readonly audioPump: AirGatewayAudioPump;
  private readonly ttsUplink: AirGatewayTtsUplink;
  private readonly admission: AirDeviceBootAdmission;
  private readonly exchange: VuartV1SerialCommandExchange;
  private readonly ingress: AirDeviceGatewayCommandIngress;
  private readonly room: AirGatewayRoomSession;
  private readonly carrier = new AirGatewayCarrierStateRegistry();
  private readonly carrierDispatcher: AirGatewayCarrierEventDispatcher;
  private readonly liveKitDispatcher: AirGatewayCarrierEventDispatcher<AirDeviceLiveKitParticipantEventRequest>;
  private readonly heartbeatDispatcher: AirGatewayCarrierEventDispatcher<AirDeviceHeartbeatRequest>;
  private readonly serialRecovery: SerialReconnectSupervisor;
  private readonly router: AirDeviceSessionRouter;
  private readonly commandService: AirGatewayCommandService;
  private readonly server;
  private readonly heartbeatEvents = { observed: 0, buildFailures: 0 };
  private readonly unsubscribeFrame: () => void;
  private readonly unsubscribeDisconnect: () => void;
  private started = false;
  constructor(private readonly options: {
    config: AirGatewayDaemonConfig;
    serial: SerialTransport;
    createRoom: () => AirDeviceRoomClient;
    carrierClient: {
      publish(event: AirDeviceCarrierEventRequest): Promise<void>;
      publishLiveKit(event: AirDeviceLiveKitParticipantEventRequest): Promise<void>;
      publishHeartbeat(event: AirDeviceHeartbeatRequest): Promise<void>;
      admitTrack(request: AirDeviceTrackAdmissionRequest):
        Promise<AirDeviceTrackAdmissionDto>;
    };
    commandLedger?: AirGatewayCommandLedger;
    eventOutboxes?: AirGatewayEventOutboxes;
    now?: () => Date;
  }) {
    const now = options.now ?? (() => new Date());
    const allocateHostFrameSequence = createUint32SequenceAllocator();
    const outboxes = options.eventOutboxes ??
      createAirGatewayEventOutboxes(options.config.eventOutboxDirectory);
    this.audioQueue = new BoundedDeviceAudioQueue(100);
    this.frames = new VuartSerialFrameTransport(options.serial);
    this.serialRecovery = new SerialReconnectSupervisor(this.frames);
    this.admission = new AirDeviceBootAdmission({
      expectedDeviceId: options.config.deviceId,
      heartbeatTimeoutMs: options.config.heartbeatTimeoutMs,
      frameSource: this.frames,
      onHeartbeatAccepted: (snapshot) =>
        this.publishHeartbeat(snapshot, now()),
    });
    this.exchange = new VuartV1SerialCommandExchange(this.frames, {
      responseTimeoutMs: options.config.responseTimeoutMs,
      maxPendingCommands: options.config.maxInFlightCommands,
    });
    this.ingress = new AirDeviceGatewayCommandIngress(this.exchange, {
      maxAttempts: 2,
      maxInFlightCommands: options.config.maxInFlightCommands,
      admission: this.admission,
      nextSequence: allocateHostFrameSequence,
    });
    this.carrierDispatcher = new AirGatewayCarrierEventDispatcher({
      client: options.carrierClient,
      outbox: outboxes.carrier,
    });
    this.liveKitDispatcher = new AirGatewayCarrierEventDispatcher({
      client: { publish: (event) => options.carrierClient.publishLiveKit(event) },
      outbox: outboxes.liveKit,
    });
    this.heartbeatDispatcher = new AirGatewayCarrierEventDispatcher({
      client: { publish: (event) => options.carrierClient.publishHeartbeat(event) },
      outbox: outboxes.heartbeat,
    });
    this.ttsUplink = new AirGatewayTtsUplink({
      transport: this.frames,
      nextFrameSequence: allocateHostFrameSequence,
      nowMs: () => BigInt(now().getTime()),
      currentBinding: () => this.router.binding(),
      carrierConnected: (binding) => {
        const hello = this.admission.snapshot().hello;
        return Boolean(hello && hello.capabilityFlags &
          VuartV1Capability.AUDIO_UPLINK_16K) &&
          this.carrier.reconcile(binding)?.state === "connected";
      },
    });
    this.room = new AirGatewayRoomSession({
      createRoom: options.createRoom,
      admitTrack: (request) => options.carrierClient.admitTrack(request),
      onTtsFrame: (frame) => { this.ttsUplink.accept(frame); },
      initialEventSequence: now().getTime() * 1_000,
      onParticipantState: (event) => {
        this.handleRoomMediaState(event);
        const bootId = this.admission.snapshot().bootId;
        if (bootId) {
          void this.liveKitDispatcher.enqueue(
            airGatewayLiveKitEventRequest(event, bootId, now()),
          ).catch(() => undefined);
        }
      },
    });
    this.router = new AirDeviceSessionRouter({
      queue: this.audioQueue,
      decoder: new VuartV1PayloadDecoder(),
      onCarrierEvent: (event) => {
        const observedAt = now();
        this.carrier.observe(event, observedAt);
        const bootId = this.admission.snapshot().bootId;
        if (bootId) {
          void this.carrierDispatcher.enqueue(
            airGatewayCarrierEventRequest(event, bootId, observedAt),
          ).catch(() => undefined);
        }
        if (["disconnected", "busy", "failed"].includes(event.carrierState)) {
          this.audioPump.suspend();
          this.ttsUplink.suspend(event.callGeneration);
          this.audioQueue.discardQueuedFrames(event.callGeneration);
          void this.room.clear(event).catch(() => undefined);
        }
      },
    });
    this.audioPump = new AirGatewayAudioPump({
      queue: this.audioQueue,
      currentBinding: () => this.router.binding(),
      currentRoom: (binding) => this.room.client(binding),
    });
    this.unsubscribeFrame = this.frames.onFrame((frame) => {
      if (frame.type !== VuartFrameType.AUDIO_DOWNLINK &&
        frame.type !== VuartFrameType.CALL_STATE) return;
      const result = this.router.route(frame);
      if (result.accepted && result.kind === "audio") this.audioPump.notify();
    });
    this.unsubscribeDisconnect = this.frames.onDisconnect((reason) => {
      this.audioPump.suspend();
      this.ttsUplink.suspend();
      this.router.disconnect(reason);
      void this.room.shutdown().catch(() => undefined);
      this.serialRecovery.recover(reason);
    });
    this.commandService = new AirGatewayCommandService({
      ingress: this.ingress,
      prepareDevice: (request) => this.prepareDevice(request),
      prepareRoom: (request) => this.room.prepare(request),
      rollbackDevice: (request) => this.rollbackDevice(request),
      clearRoom: (request) => this.room.clear(bindingOf(request)),
      observeCarrier: (binding) => this.carrier.reconcile(binding),
      ledger: options.commandLedger ??
        new FileAirGatewayCommandLedger(options.config.commandLedgerPath),
      maxRecords: options.config.maxCommandRecords,
      now,
    });
    this.server = createAirGatewayHttpServer({
      commandService: this.commandService,
      apiSecret: options.config.commandApiSecret,
      commandTimeoutMs: options.config.commandTimeoutMs,
      readiness: () => this.readiness(),
    });
  }

  async start() {
    if (this.started) return;
    await Promise.all([
      this.commandService.initialize(),
      this.carrierDispatcher.initialize(),
      this.liveKitDispatcher.initialize(),
      this.heartbeatDispatcher.initialize(),
    ]);
    await this.frames.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        this.server.once("error", onError);
        this.server.listen(this.options.config.port, this.options.config.host, () => {
          this.server.off("error", onError);
          resolve();
        });
      });
      this.started = true;
    } catch (error) {
      await this.frames.close().catch(() => undefined);
      throw error;
    }
  }

  async stop() {
    if (this.server.listening) {
      await new Promise<void>((resolve, reject) =>
        this.server.close((error) => error ? reject(error) : resolve()));
    }
    this.started = false;
    await Promise.all([
      this.carrierDispatcher.flush(),
      this.liveKitDispatcher.flush(),
      this.heartbeatDispatcher.flush(),
    ]);
    this.carrierDispatcher.dispose();
    this.liveKitDispatcher.dispose();
    this.heartbeatDispatcher.dispose();
    this.audioPump.suspend();
    this.ttsUplink.suspend();
    await this.room.shutdown().catch(() => undefined);
    this.unsubscribeFrame();
    this.unsubscribeDisconnect();
    this.ingress.dispose();
    this.exchange.dispose();
    this.admission.dispose();
    await this.serialRecovery.stop();
    await this.frames.close();
  }

  address() {
    const address = this.server.address();
    return address && typeof address !== "string" ? address as AddressInfo : null;
  }

  readiness() {
    const boot = this.admission.snapshot();
    const ttyOpen = this.frames.isOpen;
    const carrierEvents = this.carrierDispatcher.metrics();
    const liveKitEvents = this.liveKitDispatcher.metrics();
    const heartbeatDispatcher = this.heartbeatDispatcher.metrics();
    const outboxesReady = carrierEvents.persistenceHealthy &&
      liveKitEvents.persistenceHealthy && heartbeatDispatcher.persistenceHealthy;
    return {
      ready: this.started && ttyOpen && Boolean(boot.hello) &&
        Boolean(boot.heartbeat) && outboxesReady,
      process: this.started ? "ready" : "starting",
      tty: ttyOpen ? "open" : "closed",
      dtr: ttyOpen ? "asserted" : "not_asserted",
      hello: boot.hello ? "observed" : "missing",
      heartbeat: boot.heartbeat ? "observed" : "missing",
      bootAdmission: boot.state,
      serialRecovery: this.serialRecovery.metrics(),
      room: this.room.snapshot().state,
      commands: this.commandService.metrics(),
      carrierEvents,
      liveKitEvents,
      heartbeatEvents: { ...this.heartbeatEvents, ...heartbeatDispatcher },
      media: {
        ...this.audioPump.metrics(),
        ttsUplink: this.ttsUplink.metrics(),
        router: this.router.metrics(),
      },
    };
  }

  private handleRoomMediaState(event: SessionBoundLiveKitParticipantState) {
    if (event.liveKitParticipantState === "joined") {
      this.audioPump.resume();
      this.ttsUplink.resume(event);
      return;
    }
    this.audioPump.suspend();
    this.ttsUplink.suspend(event.callGeneration);
    this.audioQueue.discardQueuedFrames(event.callGeneration);
  }

  private publishHeartbeat(
    snapshot: AirDeviceBootAdmissionSnapshot,
    observedAt: Date,
  ) {
    this.heartbeatEvents.observed += 1;
    try {
      const request = airGatewayHeartbeatRequest(snapshot, observedAt);
      void this.heartbeatDispatcher.enqueue(request).catch(() => undefined);
    } catch {
      this.heartbeatEvents.buildFailures += 1;
    }
  }

  private prepareDevice(input: AirDeviceSessionBinding & { type: string }) {
    if (input.deviceId !== this.options.config.deviceId) {
      throw new Error("Air Gateway command targets another device");
    }
    const binding = bindingOf(input);
    const active = this.router.binding();
    if (active && !sameSessionBinding(active, binding)) {
      throw new Error("Air Gateway device session is already bound");
    }
    const boot = this.admission.snapshot();
    if (!boot.bootId || !boot.heartbeat) {
      throw new Error("Air Gateway device boot is not ready");
    }
    if (boot.state !== "admitted" || !boot.authorizedBinding ||
      !sameSessionBinding(boot.authorizedBinding, binding)) {
      this.admission.completeReconcile({
        bootId: boot.bootId,
        authorizedBinding: binding,
      });
    }
    if (!active) {
      this.router.bind(binding);
      return true;
    }
    return false;
  }

  private rollbackDevice(input: AirDeviceSessionBinding) {
    const active = this.router.binding();
    if (!active || !sameSessionBinding(active, bindingOf(input))) return;
    this.audioPump.suspend();
    this.ttsUplink.suspend(input.callGeneration);
    this.router.disconnect("dial_pre_dispatch_rollback");
  }
}
