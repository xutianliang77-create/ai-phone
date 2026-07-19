import type {
  EnterpriseMeetingScreenShareDto,
  EnterpriseMeetingScreenShareQuality,
} from "@translation/contracts";
import type { EnterpriseMeetingApi } from "../api/enterprise-meeting-api.js";
import type { EnterpriseContentRequestContext } from "../api/enterprise-api.js";
import {
  enterpriseScreenCaptureReady,
  EnterpriseMeetingScreenSharePublisher,
  enterpriseScreenShareErrorCode,
  type EnterpriseScreenCapture,
} from "./enterprise-meeting-screen-share-publisher.js";
import { EnterpriseMeetingScreenShareRevocationController } from
  "./enterprise-meeting-screen-share-revocation.js";
type Revocation = "not_required" | "completed" | "pending";
type Operation = "idle" | "capturing" | "starting" | "active" | "pausing" |
  "paused" | "resuming" | "stopping" | "failed";
export interface EnterpriseMeetingScreenShareSnapshot {
  operation: Operation;
  share: EnterpriseMeetingScreenShareDto | null;
  localTrack: MediaStreamTrack | null;
  localSystemAudioAvailable: boolean;
  revocation: Revocation;
  errorCode?: string;
}
export class EnterpriseMeetingScreenShareController {
  private readonly publisher = new EnterpriseMeetingScreenSharePublisher();
  private snapshot: EnterpriseMeetingScreenShareSnapshot = {
    operation: "idle", share: null, localTrack: null,
    localSystemAudioAvailable: false, revocation: "not_required",
  };
  private capture: EnterpriseScreenCapture | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private disposed = false;
  private stopRequested = false;
  private stateEpoch = 0;
  private readonly revocations: EnterpriseMeetingScreenShareRevocationController;
  constructor(
    private readonly api: EnterpriseMeetingApi,
    private readonly context: EnterpriseContentRequestContext,
    private readonly meetingId: string,
    private readonly participantId: string,
    private readonly onSnapshot: (
      value: EnterpriseMeetingScreenShareSnapshot,
    ) => void,
  ) {
    this.revocations = new EnterpriseMeetingScreenShareRevocationController(
      api, context, meetingId, () => this.disposed, (value) => this.emit(value),
    );
  }
  startPolling() {
    void this.refresh();
    this.pollTimer ??= setInterval(() => void this.refresh(), 2_000);
  }
  async start(quality: EnterpriseMeetingScreenShareQuality, includesSystemAudio: boolean) {
    if (this.busy || this.capture || this.disposed) return;
    this.stateEpoch += 1;
    this.busy = true;
    this.emit({ operation: "capturing", errorCode: undefined });
    try {
      const capture = await this.publisher.capture(quality, includesSystemAudio);
      this.capture = capture;
      capture.videoTrack.addEventListener("ended", this.browserEnded, { once: true });
      capture.audioTrack?.addEventListener("ended", this.systemAudioEnded, { once: true });
      this.emit({ operation: "starting", localTrack: capture.videoTrack,
        localSystemAudioAvailable: capture.audioTrack !== null });
      const meeting = await this.api.getMeeting(this.context, this.meetingId);
      const response = await this.api.acquireMeetingScreenShare(
        this.context,
        this.meetingId,
        {
          sourceType: capture.sourceType,
          includesSystemAudio: capture.includesSystemAudio,
          qualityMode: quality,
          expectedMeetingVersion: meeting.meeting.meeting.version,
        },
        crypto.randomUUID(),
      );
      if (!response.grant) throw new Error("screen_share_grant_missing");
      this.emit({ share: response.share, revocation: response.revocation });
      const trackSid = await this.publisher.publish(response.grant, capture);
      if (this.stopRequested || !enterpriseScreenCaptureReady(capture)) {
        throw new Error("screen_share_capture_ended");
      }
      const renewed = await this.api.commandMeetingScreenShare(
        this.context, this.meetingId, response.share.id, "renew",
        { expectedVersion: response.share.version, trackSid }, crypto.randomUUID(),
      );
      this.emit({
        operation: "active", share: renewed.share,
        revocation: renewed.revocation, errorCode: undefined,
      });
      this.startRenewing();
    } catch (error) {
      await this.failClosed(error);
    } finally {
      this.busy = false;
      await this.finishStopRequest();
    }
  }
  async pause() {
    const share = this.ownedShare("active");
    if (!share || this.busy || !this.capture || this.disposed) return;
    this.stateEpoch += 1;
    this.busy = true;
    this.stopRenewing();
    this.emit({ operation: "pausing", errorCode: undefined });
    this.capture.stream.getTracks().forEach((track) => { track.enabled = false; });
    await this.publisher.disconnect();
    try {
      const key = crypto.randomUUID();
      const response = await this.api.commandMeetingScreenShare(
        this.context, this.meetingId, share.id, "pause",
        { expectedVersion: share.version }, key,
      );
      this.emit({
        operation: response.revocation === "pending" ? "pausing" : "paused",
        share: response.share, revocation: response.revocation,
      });
      if (response.revocation === "pending") {
        this.revocations.retry("pause", share, key);
      }
    } catch (error) {
      await this.failClosed(error);
    } finally {
      this.busy = false;
      await this.finishStopRequest();
    }
  }
  async resume() {
    const share = this.ownedShare("paused");
    if (!share || this.busy || !this.capture || this.disposed) return;
    this.stateEpoch += 1;
    this.busy = true;
    this.emit({ operation: "resuming", errorCode: undefined });
    try {
      const response = await this.api.commandMeetingScreenShare(
        this.context, this.meetingId, share.id, "resume",
        { expectedVersion: share.version }, crypto.randomUUID(),
      );
      if (!response.grant) throw new Error("screen_share_grant_missing");
      this.emit({ share: response.share, revocation: response.revocation });
      this.capture.stream.getTracks().forEach((track) => { track.enabled = true; });
      const trackSid = await this.publisher.publish(response.grant, this.capture);
      if (this.stopRequested || !enterpriseScreenCaptureReady(this.capture)) {
        throw new Error("screen_share_capture_ended");
      }
      const renewed = await this.api.commandMeetingScreenShare(
        this.context, this.meetingId, share.id, "renew",
        { expectedVersion: response.share.version, trackSid }, crypto.randomUUID(),
      );
      this.emit({ operation: "active", share: renewed.share, revocation: renewed.revocation });
      this.startRenewing();
    } catch (error) {
      await this.failClosed(error);
    } finally {
      this.busy = false;
      await this.finishStopRequest();
    }
  }
  async stop() {
    const share = this.snapshot.share;
    if (!share || share.participantId !== this.participantId ||
      ["ended", "expired"].includes(share.status) || this.busy) {
      await this.stopLocalCapture();
      return;
    }
    this.stateEpoch += 1;
    this.busy = true;
    this.emit({ operation: "stopping", errorCode: undefined });
    await this.stopLocalCapture();
    const key = crypto.randomUUID();
    try {
      const response = await this.api.commandMeetingScreenShare(
        this.context, this.meetingId, share.id, "stop",
        { expectedVersion: share.version }, key,
      );
      this.emit({
        operation: response.revocation === "pending" ? "stopping" : "idle",
        share: response.share, revocation: response.revocation,
      });
      if (response.revocation === "pending") {
        this.revocations.retry("stop", share, key);
      }
    } catch (error) {
      this.emit({ operation: "failed",
        errorCode: enterpriseScreenShareErrorCode(error) });
    } finally {
      this.busy = false;
    }
  }
  async forceStop() {
    await this.revocations.forceStop({
      share: this.snapshot.share, participantId: this.participantId,
      busy: this.busy,
      onStart: () => {
        this.stateEpoch += 1; this.busy = true;
        this.emit({ operation: "stopping", errorCode: undefined });
      },
      onFinish: () => { this.busy = false; },
    });
  }
  dispose() {
    const share = this.snapshot.share;
    this.stateEpoch += 1;
    this.disposed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    void this.stopLocalCapture();
    if (share?.participantId === this.participantId &&
      ["active", "paused"].includes(share.status)) {
      void this.api.commandMeetingScreenShare(
        this.context, this.meetingId, share.id, "stop",
        { expectedVersion: share.version }, crypto.randomUUID(),
      ).catch(() => undefined);
    }
  }
  private readonly browserEnded = () => {
    this.stopRequested = true;
    void this.stopLocalCapture().then(() => {
      if (!this.busy) {
        this.stopRequested = false;
        return this.stop();
      }
      return undefined;
    });
  };
  private readonly systemAudioEnded = () => {
    const capture = this.capture;
    if (!capture?.audioTrack) return;
    if (this.snapshot.operation !== "active") return this.browserEnded();
    if (!this.publisher.degradeSystemAudio(capture)) return;
    this.emit({ localSystemAudioAvailable: false, errorCode: "screen_share_audio_ended" });
  };
  private async refresh() {
    if (this.disposed || this.busy || this.snapshot.revocation === "pending" &&
      ["pausing", "stopping"].includes(this.snapshot.operation)) return;
    const epoch = this.stateEpoch;
    try {
      const current = await this.api.currentMeetingScreenShare(this.context, this.meetingId);
      if (epoch !== this.stateEpoch) return;
      const local = this.snapshot.share;
      if (this.capture && local && (!current.share || current.share.id !== local.id ||
        current.share.generation !== local.generation && local.status === "active" ||
        ["ended", "expired"].includes(current.share.status))) {
        await this.stopLocalCapture();
      }
      const failedOwnPublisher = current.share?.participantId === this.participantId &&
        current.share.status === "active" && !this.capture &&
        ["failed", "stopping"].includes(this.snapshot.operation);
      const operation = failedOwnPublisher ? "stopping" :
        current.share?.status === "active" ? "active" :
        current.share?.status === "paused" ? "paused" :
          current.revocation === "pending" ? "stopping" : "idle";
      this.emit({ share: current.share, revocation: current.revocation, operation });
    } catch (error) {
      if (epoch === this.stateEpoch) {
        this.emit({ errorCode: enterpriseScreenShareErrorCode(error) });
      }
    }
  }
  private startRenewing() {
    this.stopRenewing();
    this.renewTimer = setInterval(() => void this.renew(), 10_000);
  }
  private async renew() {
    const share = this.ownedShare("active");
    if (!share || this.busy || this.disposed) return;
    this.stateEpoch += 1;
    this.busy = true;
    try {
      const response = await this.api.commandMeetingScreenShare(
        this.context, this.meetingId, share.id, "renew",
        { expectedVersion: share.version, ...(share.trackSid ? { trackSid: share.trackSid } : {}) },
        crypto.randomUUID(),
      );
      this.emit({ share: response.share, revocation: response.revocation, errorCode: undefined });
    } catch (error) {
      this.emit({ errorCode: enterpriseScreenShareErrorCode(error) });
      await this.refresh();
    } finally {
      this.busy = false;
      await this.finishStopRequest();
    }
  }
  private async finishStopRequest() {
    if (!this.stopRequested) return;
    this.stopRequested = false;
    await this.stop();
  }
  private ownedShare(status: "active" | "paused") {
    const share = this.snapshot.share;
    return share?.participantId === this.participantId && share.status === status ? share : null;
  }
  private async failClosed(error: unknown) {
    const share = this.snapshot.share;
    await this.stopLocalCapture();
    this.emit({ operation: "failed", errorCode: enterpriseScreenShareErrorCode(error) });
    if (share?.participantId === this.participantId && share.status === "active") {
      const key = crypto.randomUUID();
      try {
        const response = await this.api.commandMeetingScreenShare(
          this.context, this.meetingId, share.id, "stop",
          { expectedVersion: share.version }, key,
        );
        this.emit({
          share: response.share, revocation: response.revocation,
          operation: response.revocation === "pending" ? "stopping" : "idle",
        });
        if (response.revocation === "pending") {
          this.revocations.retry("stop", share, key);
        }
      } catch {
        this.emit({ operation: "stopping" });
      }
    }
  }
  private async stopLocalCapture() {
    this.stopRenewing();
    const capture = this.capture;
    this.capture = null;
    await this.publisher.disconnect();
    if (capture) {
      capture.videoTrack.removeEventListener("ended", this.browserEnded);
      capture.audioTrack?.removeEventListener("ended", this.systemAudioEnded);
      capture.stream.getTracks().forEach((track) => track.stop());
    }
    this.emit({ localTrack: null, localSystemAudioAvailable: false });
  }
  private stopRenewing() {
    if (this.renewTimer) clearInterval(this.renewTimer);
    this.renewTimer = null;
  }
  private emit(value: Partial<EnterpriseMeetingScreenShareSnapshot>) {
    if (value.share && this.snapshot.share?.id === value.share.id &&
      value.share.version < this.snapshot.share.version) return;
    this.snapshot = { ...this.snapshot, ...value };
    if (!this.disposed) this.onSnapshot(this.snapshot);
  }
}
