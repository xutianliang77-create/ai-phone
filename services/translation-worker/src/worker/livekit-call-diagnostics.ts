import type { AudioIngestMetrics } from "./audio-ingest-ring-buffer.js";
import type {
  LiveKitCallAudioSourceOptions,
  LiveKitCallDiagnosticsSnapshot,
  RtcRoom,
} from "./livekit-call-audio-source-types.js";
import { LiveKitRtcDiagnosticsCollector } from "./livekit-rtc-diagnostics.js";

type DiagnosticsOptions = Pick<
  LiveKitCallAudioSourceOptions,
  "nowMs" | "onDiagnostics" | "onError" | "onIngestMetrics" |
    "rtcStatsIntervalMs"
>;

export class LiveKitCallDiagnostics {
  private readonly latestIngestMetrics = new Map<string, AudioIngestMetrics>();
  private rtc: LiveKitRtcDiagnosticsCollector | null = null;
  private reported = false;

  constructor(private readonly options: DiagnosticsOptions) {}

  observeIngest(metrics: AudioIngestMetrics) {
    this.latestIngestMetrics.set(metrics.legId, metrics);
    this.options.onIngestMetrics?.(metrics);
  }

  startRtc(room: RtcRoom) {
    if (this.rtc) return;
    this.rtc = new LiveKitRtcDiagnosticsCollector(
      room,
      this.options.rtcStatsIntervalMs ?? 5_000,
      this.options.nowMs ?? Date.now,
    );
    this.rtc.start();
  }

  async stop(): Promise<LiveKitCallDiagnosticsSnapshot> {
    const collector = this.rtc;
    this.rtc = null;
    const rtc = collector ? await collector.stop() : undefined;
    const audioLegs = [...this.latestIngestMetrics.values()]
      .sort((left, right) => left.legId.localeCompare(right.legId))
      .map(({ event: _event, callId: _callId, ...metrics }) => metrics);
    return { audioLegs, ...(rtc ? { rtc } : {}) };
  }

  async report(snapshot: LiveKitCallDiagnosticsSnapshot) {
    if (this.reported || !this.options.onDiagnostics) return;
    this.reported = true;
    try {
      await this.options.onDiagnostics(snapshot);
    } catch (error) {
      try {
        this.options.onError?.(error);
      } catch {
        // Observability failures must not replace the media lifecycle result.
      }
    }
  }
}
