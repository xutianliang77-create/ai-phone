import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function renderCallGuestPage(callId: string) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>翻译通话</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #eef6f4; color: #12201e; }
    main { max-width: 720px; margin: 0 auto; padding: 28px 20px 148px; }
    h1 { font-size: 32px; line-height: 1.15; margin: 16px 0 8px; letter-spacing: 0; }
    .subtle { color: #52625f; font-size: 15px; line-height: 1.5; }
    .panel, .notice { background: rgba(255,255,255,.78); border: 1px solid #cfdcda; border-radius: 8px; padding: 18px; margin-top: 20px; }
    .notice { background: #fff0c2; color: #6c4400; }
    .notice ol { margin: 10px 0 0 20px; padding: 0; }
    .hidden { display: none; }
    label { display: block; font-weight: 700; margin-bottom: 8px; }
    input[type="text"] { width: 100%; box-sizing: border-box; border: 1px solid #9fb2ae; border-radius: 8px; font-size: 17px; padding: 12px; background: white; }
    .check { display: flex; gap: 10px; align-items: flex-start; margin-top: 12px; font-weight: 500; line-height: 1.45; }
    .check input { margin-top: 4px; }
    button { width: 100%; border: 0; border-radius: 999px; padding: 14px 18px; margin-top: 16px; font-size: 18px; font-weight: 700; background: #008577; color: white; }
    button:disabled { background: #9fb2ae; }
    .secondary { background: white; color: #008577; border: 1px solid #008577; }
    .link-button { border: 0; background: transparent; color: #52625f; width: auto; padding: 0; margin: 0; font-size: 13px; }
    .status { margin-top: 16px; padding: 12px 14px; border-radius: 8px; background: #dceae7; color: #233532; }
    .status.ready { background: #d5f2e3; color: #064d32; }
    .status.warn { background: #fff0c2; color: #6c4400; }
    .status.error { background: #fde2df; color: #8f1f17; }
    .meta { display: grid; gap: 8px; margin-top: 14px; font-size: 15px; color: #52625f; word-break: break-all; }
    .capabilities { display: grid; gap: 8px; margin-top: 16px; font-size: 14px; color: #52625f; }
    .capability { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px solid #dce7e5; padding-bottom: 6px; }
    .capability strong { color: #12201e; }
    .capability.warn strong { color: #8f5a00; }
    .capability.error strong { color: #8f1f17; }
    .timeline { display: grid; gap: 14px; margin-top: 18px; }
    .segment { border-left: 4px solid #008577; padding-left: 12px; }
    .speaker { color: #008577; font-size: 13px; font-weight: 700; margin-bottom: 2px; }
    .translation { color: #52625f; margin-top: 4px; }
    .tts { color: #008577; font-size: 13px; font-weight: 700; margin-top: 6px; }
    .latest { display: none; width: auto; min-width: 148px; margin: 14px auto 0; padding: 10px 16px; font-size: 15px; }
    .latest.visible { display: block; }
    .bottom { position: fixed; left: 0; right: 0; bottom: 0; background: rgba(238,246,244,.96); border-top: 1px solid #cfdcda; padding: 12px 20px 14px; }
    .bottom-inner { max-width: 720px; margin: 0 auto; display: grid; gap: 10px; }
    .footer { display: flex; justify-content: space-between; gap: 12px; color: #52625f; font-size: 13px; }
    .bottom button { margin: 0; }
  </style>
</head>
<body>
  <main>
    <p class="subtle">中英实时同声传译</p>
    <h1>翻译通话</h1>
    <section id="wechat-warning" class="notice hidden">
      <strong>检测到微信内置浏览器</strong>
      <div>麦克风或 WebRTC 可能受限。请点击右上角，在系统浏览器中打开；也可以复制链接到 Safari/Chrome，或勾选仅字幕模式先查看字幕。</div>
      <ol>
        <li>点击右上角菜单，选择在浏览器中打开。</li>
        <li>如果菜单没有该选项，先复制通话链接，再粘贴到系统浏览器。</li>
      </ol>
      <button id="copy-link" class="secondary" type="button">复制通话链接</button>
      <div id="copy-feedback" class="subtle"></div>
    </section>
    <section class="panel">
      <label for="name">你的称呼</label>
      <input id="name" autocomplete="name" placeholder="访客" type="text" />
      <label class="check"><input id="captions-only" type="checkbox" />仅字幕模式：不打开麦克风，只接收字幕和翻译语音</label>
      <label class="check"><input id="consent" type="checkbox" />我同意本次通话进行实时转写、翻译和必要的语音播放，并知晓内容会用于本次通话服务。</label>
      <button id="join" disabled>加入通话</button>
      <div id="status" class="status">等待加入</div>
      <div class="meta">
        <div>Call ID：<span id="call-id"></span></div>
        <div>Room：<span id="room-name">未连接</span></div>
      </div>
      <div id="capability-status" class="capabilities" aria-live="polite"></div>
    </section>
    <section class="panel">
      <strong>字幕</strong>
      <div id="timeline" class="timeline">
        <div class="subtle">加入后显示双方字幕和译文</div>
      </div>
      <button id="back-to-latest" class="latest secondary" type="button">回到底部</button>
      <div id="remote-audio"></div>
    </section>
  </main>
  <div class="bottom">
    <div class="bottom-inner">
      <button id="leave" class="secondary" disabled>离开</button>
      <div class="footer">
        <span>京ICP备00000000号-1A</span>
        <button id="report" class="link-button" type="button">举报/反馈</button>
      </div>
    </div>
  </div>
  <script>window.__CALL_LINK__ = { callId: ${JSON.stringify(callId)} };</script>
  <script src="/call-web/livekit-client.umd.js"></script>
  <script src="/call-web/guest.js"></script>
</body>
</html>`;
}

export async function readLiveKitClientBundle() {
  const bundlePath = require.resolve("livekit-client");
  return readFile(bundlePath, "utf8");
}
