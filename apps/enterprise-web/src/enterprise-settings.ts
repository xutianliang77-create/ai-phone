import type {
  EnterpriseUsageCategory,
  EnterpriseUsageUnit,
} from "@translation/contracts";

export const usageCategoryPresentation: Record<EnterpriseUsageCategory, {
  label: string;
  unit: EnterpriseUsageUnit;
}> = {
  meeting_audio_seconds: { label: "会议音频", unit: "seconds" },
  screen_share_seconds: { label: "屏幕共享", unit: "seconds" },
  screen_ocr_frames: { label: "屏幕 OCR", unit: "frames" },
  support_ai_seconds: { label: "AI 客服", unit: "seconds" },
  support_human_seconds: { label: "人工客服", unit: "seconds" },
  marketing_call_seconds: { label: "营销通话", unit: "seconds" },
  pstn_seconds: { label: "PSTN 通话", unit: "seconds" },
  asr_seconds: { label: "语音识别", unit: "seconds" },
  tts_characters: { label: "语音合成", unit: "characters" },
  llm_input_tokens: { label: "模型输入", unit: "tokens" },
  llm_output_tokens: { label: "模型输出", unit: "tokens" },
};

export const unitLabels: Record<EnterpriseUsageUnit, string> = {
  seconds: "秒",
  frames: "帧",
  characters: "字符",
  tokens: "Token",
};

export const providerCapabilityLabels = {
  "pstn.outbound": "PSTN 外呼",
  "crm.sync": "CRM 同步",
  "calendar.meetings": "日历会议",
  "channel.messaging": "渠道消息",
  "screen.ocr": "共享内容 OCR",
} as const;

export const providerStatusLabels = {
  not_configured: "未配置",
  checking: "检测中",
  ready: "已就绪",
  degraded: "部分可用",
  not_ready: "未就绪",
} as const;

export function formatSettingsDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
  }).format(date);
}

export function visibleFingerprint(value: string) {
  if (!value) return "未提供";
  return value.length <= 18 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}
