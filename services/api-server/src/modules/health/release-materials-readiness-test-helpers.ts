import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function readyManifest(overrides: Record<string, unknown> = {}) {
  return {
    accountDeletionUrl: "https://app.qkxy.cn/account/delete",
    androidPackageId: "cn.qkxy.realtimeinterpreter",
    androidScreenshots: [
      "screenshots/android-main.png",
      "screenshots/android-call.png",
      "screenshots/android-history.png",
    ],
    appIcpFiling: "京ICP备12345678号-1A",
    appName: "ai phone",
    appStoreChinaReady: true,
    bundleId: "cn.qkxy.realtimeinterpreter",
    customerSupportEmail: "support@qkxy.cn",
    grayReleasePlan:
      "Start at 5%, monitor crash and payment failures, then expand after approval.",
    initialGrayPercent: 5,
    iosScreenshots: [
      "screenshots/ios-main.png",
      "screenshots/ios-call.png",
      "screenshots/ios-history.png",
    ],
    keywords: ["同传", "翻译", "会议"],
    legalEntity: "北京乾坤祥云科技有限公司",
    modelProviderList: ["hymt2_self_hosted", "qwen_live_fallback"],
    privacyLabelsCompleted: true,
    privacyPolicyUrl: "https://app.qkxy.cn/privacy",
    refundPolicyUrl: "https://app.qkxy.cn/refund",
    releaseOwner: "release@qkxy.cn",
    rollbackPlan:
      "Keep previous build available and rollback within 30 minutes.",
    sdkList: ["Flutter", "LiveKit", "StoreKit"],
    shortDescription: "中英实时同声传译和通话字幕工具",
    userAgreementUrl: "https://app.qkxy.cn/terms",
    versionName: "0.1.0",
    ...overrides,
  };
}

export function writeManifest(
  tempDirs: string[],
  manifest: Record<string, unknown>,
) {
  const dir = mkdtempSync(join(tmpdir(), "translation-release-materials-"));
  tempDirs.push(dir);
  const file = join(dir, "release-materials.json");
  writeScreenshotFiles(dir, manifest);
  writeFileSync(file, JSON.stringify(manifest), "utf8");
  return file;
}

function writeScreenshotFiles(dir: string, manifest: Record<string, unknown>) {
  const screenshots = [
    ...asList(manifest.androidScreenshots),
    ...asList(manifest.iosScreenshots),
    ...asList(manifest.iphoneScreenshots),
    ...asList(manifest.iosChinaScreenshots),
  ];
  for (const item of screenshots) {
    if (/^https?:\/\//.test(item) || item.includes("missing")) continue;
    const target = join(dir, item);
    mkdirSync(dirname(target), { recursive: true });
    const content = item.endsWith(".txt")
      ? "not-an-image"
      : minimalPng(
          item.includes("tiny") ? 1 : 390,
          item.includes("tiny") ? 1 : 844,
        );
    writeFileSync(target, content);
  }
}

function asList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function minimalPng(width: number, height: number) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
