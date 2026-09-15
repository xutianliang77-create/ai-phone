/**
 * Public sessions have no client-side duration cap.  Once the server has
 * durably announced session.started, it safely ends the original session only
 * after five minutes without a confirmed non-empty ASR transcript.  Raw PCM
 * cannot reset this clock because continuous silence is still uploaded.
 */
export const PUBLIC_SPEECH_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

export class PublicSpeechInactivityWatchdog {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private closed = false;

  constructor(
    private readonly onTimeout: () => Promise<void>,
    private readonly timeoutMs = PUBLIC_SPEECH_INACTIVITY_TIMEOUT_MS,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw Error("public_speech_inactivity_timeout_invalid");
    }
  }

  start() {
    if (this.closed) return;
    this.active = true;
    this.arm();
  }

  observeSpeech() {
    if (!this.active || this.closed) return;
    this.arm();
  }

  pause() {
    this.active = false;
    this.clear();
  }

  resume() {
    if (this.closed) return;
    this.active = true;
    this.arm();
  }

  close() {
    this.closed = true;
    this.active = false;
    this.clear();
  }

  private arm() {
    this.clear();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.active || this.closed) return;
      this.active = false;
      void this.onTimeout();
    }, this.timeoutMs);
  }

  private clear() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
