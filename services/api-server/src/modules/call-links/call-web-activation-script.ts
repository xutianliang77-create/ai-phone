export function renderCallWebActivationFunctions() {
  return String.raw`
  function stopActivationPolling() {
    if (state.activationTimer) clearTimeout(state.activationTimer);
    state.activationTimer = null;
  }

  function showActivationState(activation) {
    if (activation?.status === "waiting") {
      status("已进入房间，等待发起方加入", "warn");
      pollActivation();
      return;
    }
    stopActivationPolling();
    status(
      state.captionsOnly
        ? "通话已开始，仅接收字幕和翻译语音"
        : "通话已开始，麦克风已开启",
      "ready",
    );
  }

  async function pollActivation() {
    stopActivationPolling();
    if (!state.room) return;
    state.activationTimer = setTimeout(async () => {
      try {
        const response = await fetch("/call-links/" + encodeURIComponent(callId));
        if (!response.ok) return pollActivation();
        const link = await response.json();
        if (link.status === "active") showActivationState({ status: "active" });
        else pollActivation();
      } catch {
        pollActivation();
      }
    }, 1500);
  }
`;
}
