export function renderCallWebTtsCaptureFunctions() {
  return String.raw`
  function blockMicrophoneForTts(event) {
    if (state.captionsOnly || event.speakerRole === state.localRole || !state.room) return;
    if (state.fullDuplexEnabled && !state.duplexDegraded) return;
    const durationMs = Number(event.audioDurationMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    const segmentId = event.segmentId || "";
    if (segmentId && state.gatedTtsSegments.has(segmentId)) return;
    if (segmentId) state.gatedTtsSegments.add(segmentId);
    if (state.gatedTtsSegments.size > 100) {
      state.gatedTtsSegments.delete(state.gatedTtsSegments.values().next().value);
    }
    const now = Date.now();
    const cooldownMs = 500;
    const queuedAudioEnd = state.captureBlockedUntil > now
      ? state.captureBlockedUntil - cooldownMs
      : now;
    state.captureBlockedUntil = Math.max(now, queuedAudioEnd) +
      Math.min(30000, Math.max(200, Math.trunc(durationMs))) + cooldownMs;
    clearTimeout(state.captureTimer);
    state.room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    scheduleMicrophoneRestore(state.room);
  }

  function scheduleMicrophoneRestore(room) {
    clearTimeout(state.captureTimer);
    state.captureTimer = setTimeout(async () => {
      if (state.room !== room) return;
      const remainingMs = state.captureBlockedUntil - Date.now();
      if (remainingMs > 0) {
        scheduleMicrophoneRestore(room);
        return;
      }
      if (!state.captionsOnly) {
        await room.localParticipant.setMicrophoneEnabled(true).catch(() => {});
      }
    }, Math.max(0, state.captureBlockedUntil - Date.now()));
  }

  function resetTtsCaptureGate() {
    clearTimeout(state.captureTimer);
    state.captureTimer = null;
    state.captureBlockedUntil = 0;
    state.gatedTtsSegments.clear();
  }

  function callAudioCaptureOptions() {
    return {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
  }
`;
}
