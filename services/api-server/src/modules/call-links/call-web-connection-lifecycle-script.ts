export function renderCallWebConnectionLifecycleFunctions() {
  return String.raw`
  function bindRoomConnectionLifecycle(room) {
    const lk = window.LivekitClient;
    const reconnecting = () => {
      stopActivationPolling();
      status("网络中断，正在重连", "warn");
    };
    const reconnectEvents = new Set([
      lk.RoomEvent.SignalReconnecting,
      lk.RoomEvent.Reconnecting,
    ].filter(Boolean));
    reconnectEvents.forEach((event) => room.on(event, reconnecting));
    room.on(lk.RoomEvent.Reconnected, () => {
      syncLocalTrackPermissions(room);
      syncRemoteAudioSubscriptions(room);
      const microphoneEnabled =
        !state.captionsOnly && room.localParticipant?.isMicrophoneEnabled !== false;
      status(
        state.captionsOnly
          ? "已恢复加入，仅接收字幕和翻译语音"
          : microphoneEnabled
            ? "已恢复加入，麦克风已开启"
            : "已恢复加入，麦克风未开启",
        state.captionsOnly || microphoneEnabled ? "ready" : "warn",
      );
    });
    room.on(lk.RoomEvent.Disconnected, () => {
      stopActivationPolling();
      resetTtsCaptureGate();
      state.room = null;
      state.expectedRoomName = "";
      status("通话已断开", "error");
      $("leave").disabled = true;
      $("remote-audio").textContent = "";
      updateJoinButton();
    });
  }
`;
}
