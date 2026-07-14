export function renderCallWebEnvironmentFunctions() {
  return String.raw`
  function detectEnvironment() {
    const userAgent = navigator.userAgent || "";
    const isWechat = /MicroMessenger/i.test(userAgent);
    $("wechat-warning").classList.toggle("hidden", !isWechat);
    renderCapabilities([
      capability("系统浏览器", !isWechat, isWechat ? "建议在 Safari/Chrome 打开" : "当前浏览器可继续"),
      capability("安全上下文", window.isSecureContext || location.hostname === "localhost", "麦克风需要 HTTPS 或 localhost"),
      capability("麦克风接口", Boolean(navigator.mediaDevices?.getUserMedia), "不可用时可使用仅字幕模式"),
      capability("LiveKit SDK", Boolean(window.LivekitClient?.Room), "通话 SDK 加载失败时无法入房"),
      capability("音频解锁", state.audioUnlocked, "点击加入时会自动尝试解锁"),
    ]);
    const hints = [];
    if (isWechat) hints.push("微信内置浏览器可能限制麦克风，请优先在系统浏览器打开");
    if (!window.isSecureContext && location.hostname !== "localhost") {
      hints.push("当前页面不是安全上下文，浏览器可能拒绝麦克风");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      hints.push("当前浏览器未暴露麦克风接口，可使用仅字幕模式");
    }
    if (hints.length > 0) status(hints.join("；"), "warn");
  }

  function capability(label, ok, detail) {
    return { label, ok, detail };
  }

  function renderCapabilities(items) {
    $("capability-status").innerHTML = items.map((item) => {
      const kind = item.ok ? "ready" : "warn";
      const value = item.ok ? "可用" : "需处理";
      return '<div class="capability ' + kind + '"><span>' + item.label + '<br><small>' + item.detail + '</small></span><strong>' + value + '</strong></div>';
    }).join("");
  }
`;
}
