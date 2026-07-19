import { LiveKitCallAudioTrackRuntime } from
  "./livekit-call-audio-track-runtime.js";
import type { RtcNodeModule } from "./livekit-call-audio-source-types.js";
import type { CallAudioSpeakerRole } from "./types.js";

interface ActiveAudioTrack {
  runtime: LiveKitCallAudioTrackRuntime;
  task: Promise<void>;
}

export class LiveKitCallAudioTrackRegistry {
  private readonly active = new Map<string, ActiveAudioTrack>();

  async stopPrevious(sourceKey: string) {
    const previous = this.active.get(sourceKey);
    if (!previous) return;
    previous.runtime.stop(true);
    await previous.task;
  }

  set(
    sourceKey: string,
    runtime: LiveKitCallAudioTrackRuntime,
    task: Promise<void>,
  ) {
    this.active.set(sourceKey, { runtime, task });
  }

  deleteIfCurrent(sourceKey: string, runtime: LiveKitCallAudioTrackRuntime) {
    if (this.active.get(sourceKey)?.runtime === runtime) {
      this.active.delete(sourceKey);
    }
  }
}

export function audioSourceKey(
  speakerRole: CallAudioSpeakerRole,
  participant: unknown,
) {
  const identity = (participant as { identity?: unknown })?.identity;
  return typeof identity === "string" && identity.trim()
    ? `${speakerRole}:${identity}`
    : speakerRole;
}

export async function loadRtcNodeModule(
  loader?: () => Promise<RtcNodeModule>,
) {
  try {
    if (loader) return await loader();
    const dynamicImport = new Function("name", "return import(name)") as
      (name: string) => Promise<RtcNodeModule>;
    return await dynamicImport("@livekit/rtc-node");
  } catch (error) {
    throw new Error(
      "LiveKit Node RTC runtime is unavailable. Install @livekit/rtc-node before running the Translation Worker.",
      { cause: error },
    );
  }
}
