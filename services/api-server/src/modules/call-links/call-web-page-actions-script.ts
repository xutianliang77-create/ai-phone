export function renderCallWebPageActionFunctions() {
  return String.raw`
  function reportCall() {
    const subject = encodeURIComponent("举报 ai phone 翻译通话");
    const body = encodeURIComponent("Call ID: " + callId + "\n请描述问题：");
    window.location.href = "mailto:support@example.cn?subject=" + subject + "&body=" + body;
  }

  async function copyCallLink() {
    const link = window.location.href;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const input = document.createElement("textarea");
        input.value = link;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      $("copy-feedback").textContent = "已复制，请粘贴到系统浏览器打开。";
    } catch {
      $("copy-feedback").textContent = "复制失败，请长按地址栏复制链接。";
    }
  }
`;
}
