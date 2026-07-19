import { useEffect, useRef, useState } from "react";
import type {
  EnterpriseMeetingScreenOcrDisplayMode,
  EnterpriseMeetingScreenOcrResponse,
  EnterpriseMeetingScreenShareDto,
} from "@translation/contracts";
import type { EnterpriseApi, EnterpriseContentRequestContext } from
  "../api/enterprise-api.js";
import { MaterialIcon } from "../components/MaterialIcon.js";

export function MeetingScreenOcrControls(props: {
  api: EnterpriseApi;
  context: EnterpriseContentRequestContext;
  meetingId: string;
  share: EnterpriseMeetingScreenShareDto | null;
  defaultLanguage: "zh" | "en";
  onView(value: EnterpriseMeetingScreenOcrResponse | null): void;
}) {
  const [view, setView] = useState<EnterpriseMeetingScreenOcrResponse | null>(null);
  const [targetLanguage, setTargetLanguage] = useState<"zh" | "en">(
    props.defaultLanguage,
  );
  const [displayMode, setDisplayMode] =
    useState<EnterpriseMeetingScreenOcrDisplayMode>("bilingual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const share = props.share?.status === "active" ? props.share : null;
  const shareKey = share ? `${share.id}:${share.generation}` : "none";
  const currentShareKey = useRef(shareKey);
  currentShareKey.current = shareKey;

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await props.api.currentMeetingScreenOcr(
          props.context, props.meetingId,
        );
        if (!active) return;
        setError(null);
        const scoped = next.run && share && next.run.shareId === share.id &&
          next.run.shareGeneration === share.generation ? next : null;
        setView(scoped); props.onView(scoped);
        if (scoped?.subscription) {
          setTargetLanguage(scoped.subscription.targetLanguage);
          setDisplayMode(scoped.subscription.displayMode);
        }
      } catch {
        if (active) setError("screen_ocr_request_failed");
      }
    };
    setView(null); props.onView(null); setError(null);
    if (share) {
      void load();
      const timer = window.setInterval(() => void load(), 4_000);
      return () => { active = false; window.clearInterval(timer); };
    }
    return () => { active = false; };
  }, [props.api, props.context, props.meetingId, share?.id, share?.generation]);

  if (!share) return null;
  const enabled = view?.subscription?.enabled === true;
  const apply = async () => {
    const expectedShareKey = shareKey;
    setBusy(true); setError(null);
    try {
      const next = await props.api.enableMeetingScreenOcr(
        props.context, props.meetingId,
        { shareId: share.id, expectedShareVersion: share.version,
          targetLanguage, displayMode }, crypto.randomUUID(),
      );
      if (currentShareKey.current !== expectedShareKey) return;
      setView(next); props.onView(next);
    } catch { setError("screen_ocr_request_failed"); }
    finally { setBusy(false); }
  };
  const disable = async () => {
    const subscription = view?.subscription;
    if (!subscription) return;
    const expectedShareKey = shareKey;
    setBusy(true); setError(null);
    try {
      const next = await props.api.disableMeetingScreenOcr(
        props.context, props.meetingId, subscription.version, crypto.randomUUID(),
      );
      if (currentShareKey.current !== expectedShareKey) return;
      setView(next); props.onView(next);
    } catch { setError("screen_ocr_request_failed"); }
    finally { setBusy(false); }
  };

  return <section className="meeting-screen-ocr" aria-label="共享内容翻译">
    <header><MaterialIcon name="translate" outlined />
      <div><strong>共享内容翻译</strong>
        <small>主动开启后低频识别变化区域；默认不保存屏幕帧。</small></div>
      <span className={`meeting-screen-ocr__status status--${view?.run?.status ?? "off"}`}>
        {statusLabel(view?.run?.status ?? "off")}
      </span>
    </header>
    <div className="meeting-screen-ocr__controls">
      <label>译文语言<select value={targetLanguage} disabled={busy}
        onChange={(event) => setTargetLanguage(event.target.value as "zh" | "en")}>
        <option value="zh">中文</option><option value="en">English</option>
      </select></label>
      <label>画面显示<select value={displayMode} disabled={busy}
        onChange={(event) => setDisplayMode(
          event.target.value as EnterpriseMeetingScreenOcrDisplayMode,
        )}>
        <option value="original">原图</option>
        <option value="translated">译图</option>
        <option value="bilingual">双语对照</option>
      </select></label>
      <button className="button button--primary" type="button" disabled={busy}
        onClick={() => void apply()}>
        <MaterialIcon name="translate" />{enabled ? "应用设置" : "开启内容翻译"}
      </button>
      {enabled ? <button className="button button--secondary" type="button"
        disabled={busy} onClick={() => void disable()}>
        <MaterialIcon name="visibility_off" outlined />关闭
      </button> : null}
    </div>
    {view?.run?.status === "not_configured" || view?.run?.status === "failed" ?
      <p className="meeting-screen-ocr__notice" role="status">
        {reasonLabel(view.run.reasonCode)} 原共享画面和会议字幕继续可用。
      </p> : null}
    {view?.run?.status === "pending" ? <p className="meeting-screen-ocr__notice">
      OCR Worker 正在等待授权轨道；就绪前只显示原共享画面。
    </p> : null}
    {error ? <p className="meeting-screen-ocr__notice" role="status">
      {reasonLabel(error)} 原共享画面不受影响。
    </p> : null}
  </section>;
}

function statusLabel(value: string) {
  return ({ off: "未开启", pending: "正在启动", active: "翻译中",
    not_configured: "未配置", failed: "已降级", ended: "已关闭" } as
    Record<string, string>)[value] ?? "未开启";
}
function reasonLabel(value: string | undefined) {
  return ({ screen_ocr_provider_not_configured: "当前环境未配置 OCR Provider。",
    screen_ocr_provider_configuration_invalid: "OCR Provider 配置无效。",
    screen_ocr_dispatch_not_enabled: "OCR Worker 调度尚未启用。",
    screen_ocr_signing_not_configured: "OCR Worker 签名配置尚未就绪。",
    meeting_rtc_not_configured: "会议媒体服务尚未就绪。",
    screen_ocr_provider_timeout: "OCR Provider 响应超时。",
    screen_ocr_provider_rate_limited: "OCR Provider 当前限流。",
    screen_ocr_provider_unavailable: "OCR Provider 当前不可达。",
    screen_ocr_provider_protocol_invalid: "OCR Provider 返回格式无效。",
    screen_ocr_provider_failed: "OCR Provider 处理失败。",
    screen_ocr_track_unavailable: "授权的共享轨道不可用。",
    screen_ocr_worker_fence_lost: "OCR Worker 授权已失效。",
    screen_ocr_worker_failed: "OCR Worker 已停止。",
    screen_ocr_request_failed: "共享内容翻译请求失败。" } as
    Record<string, string>)[value ?? ""] ?? "共享内容翻译当前不可用。";
}
