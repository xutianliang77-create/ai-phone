import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function buildDomesticReleaseMaterialsDraft(options = {}) {
  const root = options.root ?? process.cwd();
  const identity = loadMobileReleaseIdentity(root);
  return {
    appName: options.appName ?? "ai phone",
    bundleId:
      options.bundleId ?? identity.iosBundleId ?? "cn.qkxy.realtimeinterpreter",
    androidPackageId:
      options.androidPackageId ??
      identity.androidApplicationId ??
      "cn.qkxy.realtimeinterpreter",
    versionName: options.versionName ?? "0.1.0",
    shortDescription:
      options.shortDescription ?? "中英实时同声传译和通话字幕工具",
    keywords: options.keywords ?? [
      "同传",
      "翻译",
      "会议",
      "实时字幕",
      "中英互译",
    ],
    legalEntity: options.legalEntity ?? "北京乾坤祥云科技有限公司",
    privacyPolicyUrl: "",
    userAgreementUrl: "",
    refundPolicyUrl: "",
    accountDeletionUrl: "",
    customerSupportEmail: "",
    appIcpFiling: "京ICP备00000000号-1A",
    sdkList: ["Flutter", "LiveKit", "StoreKit", "iOS Vision", "Android ML Kit"],
    modelProviderList: [
      "self_hosted_sensevoice",
      "hymt2_self_hosted",
      "qwen_live_fallback",
      "coreml_nemotron_asr",
    ],
    iosScreenshots: defaultScreenshotPaths("ios"),
    androidScreenshots: defaultScreenshotPaths("android"),
    privacyLabelsCompleted: false,
    appStoreChinaReady: false,
    releaseOwner: "",
    rollbackPlan: "",
    grayReleasePlan: "",
    initialGrayPercent: 5,
  };
}

export function writeDomesticReleaseMaterialsDraft(options = {}) {
  const root = options.root ?? process.cwd();
  const output = path.resolve(
    root,
    options.output ?? "release/domestic/release-materials.todo.json",
  );
  if (existsSync(output) && !options.overwrite) {
    return {
      ok: false,
      output,
      issue:
        "release materials draft already exists; pass overwrite to replace it",
    };
  }
  mkdirSync(path.dirname(output), { recursive: true });
  const manifest = buildDomesticReleaseMaterialsDraft({ ...options, root });
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    ok: true,
    output,
    manifest,
    remainingRequiredFields: remainingFields(),
  };
}

function loadMobileReleaseIdentity(root) {
  return {
    iosBundleId: readLocalIdentityValue(
      path.join(root, "apps/mobile/ios/Flutter/LocalIdentity.xcconfig"),
      "TRANSLATION_IOS_BUNDLE_ID",
    ),
    androidApplicationId: readKeyPropertiesValue(
      path.join(root, "apps/mobile/android/key.properties"),
      "applicationId",
    ),
  };
}

function readLocalIdentityValue(file, key) {
  if (!existsSync(file)) return "";
  return readKeyValueLines(file, "=")[key] ?? "";
}

function readKeyPropertiesValue(file, key) {
  if (!existsSync(file)) return "";
  return readKeyValueLines(file, "=")[key] ?? "";
}

function readKeyValueLines(file, delimiter) {
  const values = {};
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf(delimiter);
    if (index === -1) continue;
    values[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return values;
}

function defaultScreenshotPaths(platform) {
  return [
    `release/domestic/screenshots/${platform}-main.png`,
    `release/domestic/screenshots/${platform}-call.png`,
    `release/domestic/screenshots/${platform}-history.png`,
  ];
}

function remainingFields() {
  return [
    "privacyPolicyUrl",
    "userAgreementUrl",
    "refundPolicyUrl",
    "accountDeletionUrl",
    "customerSupportEmail",
    "appIcpFiling: draft placeholder is allowed, replace before formal release",
    "iosScreenshots: replace placeholder paths with real store screenshots",
    "androidScreenshots: replace placeholder paths with real store screenshots",
    "privacyLabelsCompleted",
    "appStoreChinaReady",
    "releaseOwner",
    "rollbackPlan",
    "grayReleasePlan",
  ];
}
