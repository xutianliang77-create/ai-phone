import type { AddressInfo } from "node:net";
import type {
  AirDeviceCarrierEventRequest,
  AirDeviceHeartbeatRequest,
  AirDeviceLiveKitParticipantEventRequest,
  AirDeviceMediaRecoveryAccessDto,
  AirDeviceMediaRecoveryRequest,
  AirDeviceTrackAdmissionDto,
  AirDeviceTrackAdmissionRequest,
} from "@translation/contracts";
import type { AirDeviceRoomClient } from
  "../media/livekit-device-participant.js";
import { BoundedDeviceAudioQueue } from "../media/device-audio-queue.js";
import { AirDeviceBootAdmission, type AirDeviceBootAdmissionSnapshot } from "../device/air-device-boot-admission.js";
import { AirDeviceSessionRouter } from "../device/device-session-router.js";
import type { SerialTransport } from "../device/serial-transport.js";
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
  airGatewayHeartbeatRequest,
  AirGatewayCarrierStateRegistry,
} from "./air-gateway-carrier-client.js";
import { AirGatewayCommandService } from "./air-gateway-command-service.js";
import type { AirGatewayCommandLedger } from "./air-gateway-command-ledger.js";
import { FileAirGatewayCommandLedger } from "./file-air-gateway-command-ledger.js";
import { createAirGatewayHttpServer } from "./air-gateway-http-server.js";
import { AirGatewayAudioPump } from "./air-gateway-audio-pump.js";
import { AirGatewayRoomSession } from "./air-gateway-room-session.js";
import {
  bindingOf,
  airGatewayProcessHealth,
  airGatewayProtocolReadiness,
  createAirGatewayEventOutboxes,
  createUint32SequenceAllocator,
  sameSessionBinding,
  type AirGatewayEventOutboxes,
} from "./air-device-gateway-runtime-support.js";
import { AirGatewayTtsUplink } from "./air-gateway-tts-uplink.js";
import { SerialReconnectSupervisor } from "./serial-reconnect-supervisor.js";
import { AirGatewayMediaRecovery } from "./air-gateway-media-recovery.js";
import { AirGatewayDeviceBindingController } from
  "./air-gateway-device-binding-controller.js";
import { AirGatewayRuntimeMediaController } from
  "./air-gateway-runtime-media-controller.js";

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
  private readonly mediaRecovery: AirGatewayMediaRecovery;
  private readonly bindingController: AirGatewayDeviceBindingController;
  private readonly mediaController: AirGatewayRuntimeMediaController;
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
      recoverMedia(input: AirDeviceMediaRecoveryRequest):
        Promise<AirDeviceMediaRecoveryAccessDto>;
      admitTrack(request: AirDeviceTrackAdmissionRequest):
        Promise<AirDeviceTrackAdmissionDto>;
    };
    commandLedger?: AirGatewayCommandLedger;
    eventOutboxes?: AirGatewayEventOutboxes;
    now?: () => Date;
    serialRecoveryRetryDelayMs?: number;
  }) {
    const now = options.now ?? (() => new Date());
    const allocateHostFrameSequence = createUint32SequenceAllocator();
    const outboxes = options.eventOutboxes ??
      createAirGatewayEventOutboxes(options.config.eventOutboxDirectory);
    this.audioQueue = new BoundedDeviceAudioQueue(100);
    this.frames = new VuartSerialFrameTransport(options.serial);
    this.serialRecovery = new SerialReconnectSupervisor(this.frames, {
      retryDelayMs: options.serialRecoveryRetryDelayMs,
    });
    this.admission = new AirDeviceBootAdmission({
      expectedDeviceId: options.config.deviceId,
      heartbeatTimeoutMs: options.config.heartbeatTimeoutMs,
      requiredCapabilityFlags: VuartV1Capability.CALL_CONTROL |
        VuartV1Capability.AUDIO_DOWNLINK_16K |
        VuartV1Capability.AUDIO_UPLINK_16K,
      minimumMaxPayloadBytes: 8_192,
      frameSource: this.frames,
      onHeartbeatAccepted: (snapshot) => {
        this.publishHeartbeat(snapshot, now());
        this.mediaRecovery.observe(snapshot);
      },
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
      onUplinkBoundary: (binding) => {
        this.ttsUplink.discardPending(binding);
      },
      initialEventSequence: now().getTime() * 1_000,
      onParticipantState: (event) => this.mediaController.handleRoom(event),
    });
    this.router = new AirDeviceSessionRouter({
      queue: this.audioQueue,
      decoder: new VuartV1PayloadDecoder(),
      onCarrierEvent: (event) => this.mediaController.handleCarrier(event),
    });
    this.audioPump = new AirGatewayAudioPump({
      queue: this.audioQueue,
      currentBinding: () => this.router.binding(),
      currentRoom: (binding) => this.room.client(binding),
    });
    this.mediaController = new AirGatewayRuntimeMediaController({
      admission: this.admission,
      router: this.router,
      carrier: this.carrier,
      room: this.room,
      queue: this.audioQueue,
      pump: this.audioPump,
      tts: this.ttsUplink,
      carrierDispatcher: this.carrierDispatcher,
      liveKitDispatcher: this.liveKitDispatcher,
      now,
    });
    this.bindingController = new AirGatewayDeviceBindingController({
      deviceId: options.config.deviceId,
      admission: this.admission,
      router: this.router,
      suspendMedia: (binding) => {
        this.audioPump.suspend();
        this.ttsUplink.suspend(binding.callGeneration);
      },
    });
    this.mediaRecovery = new AirGatewayMediaRecovery({
      requestAccess: (binding) => options.carrierClient.recoverMedia(binding),
      isRecovered: (binding) => {
        const active = this.router.binding();
        return Boolean(active && sameSessionBinding(active, binding) &&
          this.room.client(binding));
      },
      isStillAuthoritative: (binding, bootId) =>
        this.bindingController.isStillAuthoritative(binding, bootId),
      restoreDevice: (binding) => this.bindingController.restore(binding),
      restoreCarrier: (binding, state) => this.carrier.restore(binding, state, now()),
      prepareRoom: (request) => this.room.prepare(request),
      rollbackDevice: (binding) => this.bindingController.rollback(binding),
    });
    this.unsubscribeFrame = this.frames.onFrame((frame) =>
      this.mediaController.handleFrame(frame));
    this.unsubscribeDisconnect = this.frames.onDisconnect((reason) => {
      this.audioPump.suspend();
      this.ttsUplink.suspend();
      this.router.disconnect(reason);
      void this.room.shutdown().catch(() => undefined);
      this.serialRecovery.recover(reason);
    });
    this.commandService = new AirGatewayCommandService({
      ingress: this.ingress,
      prepareDevice: (request) => this.bindingController.prepare(request),
      prepareRoom: (request) => this.room.prepare(request),
      rollbackDevice: (request) => this.bindingController.rollback(request),
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
      health: () => airGatewayProcessHealth(this.started, this.readiness()),
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
    try {
      await this.frames.open();
    } catch {
      // The stable by-id path can be absent while USB is re-enumerating. Keep
      // the local control endpoint fail-closed and retry; do not make a
      // transient device absence into a permanently dead in-container process.
      this.serialRecovery.recoverStartupFailure("serial_startup_open_failed");
    }
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
      await this.serialRecovery.stop();
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
    await this.mediaRecovery.stop();
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
      protocol: airGatewayProtocolReadiness(this.frames.metrics(), boot),
      serialRecovery: this.serialRecovery.metrics(),
      mediaRecovery: this.mediaRecovery.metrics(),
      room: this.room.snapshot().state,
      commands: this.commandService.metrics(),
      carrierEvents,
      liveKitEvents,
      heartbeatEvents: { ...this.heartbeatEvents, ...heartbeatDispatcher },
      media: {
        ...this.mediaController.metrics(),
        ...this.audioPump.metrics(),
        ttsUplink: this.ttsUplink.metrics(),
        router: this.router.metrics(),
      },
    };
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

}
