import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { checkMobileChineseInterface } from "./mobile_chinese_interface_check.mjs";

const EXPECTED_ANDROID_CERTIFICATE_SUBJECT = "北京乾坤祥云科技有限公司";

export function checkMobileAppReleaseReadiness(root, options = {}) {
  const checks = [];
  const issues = [];
  const chineseInterface = (options.chineseInterfaceCheck ?? checkMobileChineseInterface)(root);
  record(checks, "mobile_chinese_interface", chineseInterface.status === "ready", {
    failures: chineseInterface.failures,
  });
  if (chineseInterface.status !== "ready") {
    issues.push("Mobile Chinese interface readiness is not ready.");
    issues.push(...chineseInterface.failures.map((failure) => failure.issue).filter(Boolean));
  }
  checkDomesticDefaults(root, checks, issues);
  checkComplianceCenter(root, checks, issues);
  checkMobilePaymentSurface(root, checks, issues);
  checkIosReleaseMetadata(root, checks, issues);
  checkAndroidReleaseMetadata(root, checks, issues, options);
  checkAndroidSystemAsrFallback(root, checks, issues);
  return {
    schemaVersion: 1,
    status: issues.length === 0 ? "ready" : "not_ready",
    checks,
    issues,
    actions: issues.length === 0 ? [] : [
      "Set apps/mobile/ios/Flutter/LocalIdentity.xcconfig and apps/mobile/android/key.properties before store submission.",
      "Keep local-network cleartext access only in debug/profile manifests.",
    ],
  };
}

function checkAndroidSystemAsrFallback(root, checks, issues) {
  const provider = read(root, "apps/mobile/lib/src/platform/asr/android_system_asr_provider.dart");
  const factory = read(root, "apps/mobile/lib/src/features/realtime/presentation/controllers/realtime_runtime_factories.dart");
  const bridge = read(root, "apps/mobile/android/app/src/main/kotlin/com/example/translation_mobile/AndroidSystemAsrBridge.kt");
  const manifest = read(root, "apps/mobile/android/app/src/main/AndroidManifest.xml");
  requireText(checks, issues, "mobile_android_system_asr_provider", provider, [
    "class AndroidSystemAsrProvider",
    "MobileAsrDiagnostics",
    "translation_mobile/system_asr",
    "Android system ASR ready",
  ]);
  requireText(checks, issues, "mobile_android_system_asr_factory", factory, [
    "AndroidSystemAsrProvider",
    "android_system",
    "config.deviceAsrProvider == 'system'",
  ]);
  requireText(checks, issues, "mobile_android_system_asr_native_bridge", bridge, [
    "SpeechRecognizer",
    "RecognitionListener",
    "translation_mobile/system_asr/events",
    "requestPermissions",
    "scheduleRestart",
  ]);
  requireText(checks, issues, "mobile_android_system_asr_manifest_query", manifest, [
    "android.speech.RecognitionService",
  ]);
}

function checkDomesticDefaults(root, checks, issues) {
  const regionConfig = read(root, "apps/mobile/lib/src/app/region_edition_config.dart");
  const appConfig = read(root, "apps/mobile/lib/src/app/app_config.dart");
  requireText(checks, issues, "mobile_domestic_default", regionConfig, [
    "defaultValue: 'domestic'",
    "dataRegion = 'cn'",
    "callProviderPolicy = 'call_link_only'",
    "complianceProfile = 'pipl'",
  ]);
  requireText(checks, issues, "mobile_auto_language_default", appConfig, [
    "defaultValue: 'auto'",
    "defaultValue: 'zh'",
    "bool.fromEnvironment('USE_MOCK_AUDIO')",
  ]);
}

function checkMobilePaymentSurface(root, checks, issues) {
  const walletPage = read(root, "apps/mobile/lib/src/features/billing/presentation/pages/wallet_page.dart");
  const purchaseService = read(root, "apps/mobile/lib/src/platform/billing/purchase_service.dart");
  const storeKitBridge = read(root, "apps/mobile/ios/Runner/StoreKitBridge.swift");
  requireText(checks, issues, "mobile_android_payment_hidden", walletPage, [
    "TargetPlatform.iOS",
    "_paymentStack.contains('apple_iap')",
    "product.providers.contains('apple_iap')",
    "return null;",
  ]);
  requireAbsent(checks, issues, "mobile_android_payment_not_exposed", walletPage, [
    "TargetPlatform.android",
    "TargetPlatform.fuchsia",
  ]);
  requireText(checks, issues, "mobile_ios_restore_purchase_surface", walletPage + purchaseService, [
    "restorePurchases",
    "_restorePurchases",
    "finishTransaction",
    "restoreSuccess",
    "restoreEmpty",
  ]);
  requireText(checks, issues, "mobile_ios_storekit_restore_bridge", storeKitBridge, [
    "case \"restorePurchases\"",
    "AppStore.sync()",
    "Transaction.currentEntitlements",
    "Transaction.unfinished",
  ]);
}

function checkComplianceCenter(root, checks, issues) {
  const documents = read(root, "apps/mobile/lib/src/features/compliance/data/compliance_document.dart");
  requireText(checks, issues, "mobile_compliance_center", documents, [
    "隐私政策",
    "用户协议",
    "第三方 SDK 与模型服务商清单",
    "权限用途说明",
    "客服与账户",
    "support@qkxy.cn",
    "退款处理",
    "删除账号",
    "隐私反馈",
    "https://app.qkxy.cn/account/delete",
  ]);
}

function checkIosReleaseMetadata(root, checks, issues) {
  const plist = read(root, "apps/mobile/ios/Runner/Info.plist");
  const project = read(root, "apps/mobile/ios/Runner.xcodeproj/project.pbxproj");
  const zhStrings = read(root, "apps/mobile/ios/Runner/zh-Hans.lproj/InfoPlist.strings");
  const iosIdentity = loadIosIdentity(root);
  requireText(checks, issues, "ios_permission_descriptions", plist, [
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription",
    "NSPhotoLibraryUsageDescription",
    "NSLocalNetworkUsageDescription",
  ]);
  requireText(checks, issues, "ios_chinese_permission_strings", zhStrings, [
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription",
    "NSPhotoLibraryUsageDescription",
    "NSLocalNetworkUsageDescription",
  ]);
  const bundleIds = [...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)]
    .map((match) => match[1].trim())
    .filter((value) => !value.includes("RunnerTests"));
  const resolvedBundleIds = bundleIds.map((value) => resolveIosBuildSetting(value, iosIdentity));
  const realBundleId = bundleIds.length > 0 &&
    resolvedBundleIds.every((value) => Boolean(value) && !/^com\.example\b/i.test(value));
  record(checks, "ios_bundle_id_not_example", realBundleId, {
    bundleIds,
    resolvedBundleIds,
  });
  if (!realBundleId) {
    issues.push("iOS PRODUCT_BUNDLE_IDENTIFIER still uses com.example or is not configured.");
  }
}

function checkAndroidReleaseMetadata(root, checks, issues, options) {
  const manifest = read(root, "apps/mobile/android/app/src/main/AndroidManifest.xml");
  const debugManifest = read(root, "apps/mobile/android/app/src/debug/AndroidManifest.xml");
  const profileManifest = read(root, "apps/mobile/android/app/src/profile/AndroidManifest.xml");
  const gradle = read(root, "apps/mobile/android/app/build.gradle.kts");
  const androidRelease = loadAndroidReleaseProperties(root);
  requireText(checks, issues, "android_required_permissions", manifest, [
    "android.permission.INTERNET",
    "android.permission.RECORD_AUDIO",
    "android.permission.CAMERA",
  ]);
  requireAbsent(checks, issues, "android_no_broad_storage_or_package_permissions", manifest, [
    "READ_EXTERNAL_STORAGE",
    "WRITE_EXTERNAL_STORAGE",
    "MANAGE_EXTERNAL_STORAGE",
    "QUERY_ALL_PACKAGES",
  ]);
  requireAbsent(checks, issues, "android_release_cleartext_disabled", manifest, [
    "usesCleartextTraffic=\"true\"",
  ]);
  requireText(checks, issues, "android_debug_cleartext_only", debugManifest + profileManifest, [
    "usesCleartextTraffic=\"true\"",
  ]);
  const appId = resolveAndroidApplicationId(gradle, androidRelease);
  const realAppId = Boolean(appId) && !/^com\.example\b/i.test(appId);
  record(checks, "android_application_id_not_example", realAppId, { applicationId: appId });
  if (!realAppId) issues.push("Android applicationId still uses com.example or is not configured.");
  const releaseUsesDebugSigning = /release\s*\{[\s\S]*signingConfig\s*=\s*signingConfigs\.getByName\("debug"\)/m
    .test(gradle);
  record(checks, "android_release_signing_not_debug", !releaseUsesDebugSigning, {});
  if (releaseUsesDebugSigning) issues.push("Android release build still signs with debug keys.");
  const signing = androidSigningStatus(root, androidRelease);
  record(checks, "android_release_signing_configured", signing.ready, {
    missing: signing.missing,
    storeFileExists: signing.storeFileExists,
  });
  if (!signing.ready) issues.push("Android release signing properties are missing or invalid.");
  const certificate = androidCertificateSubjectStatus(root, androidRelease, options);
  record(checks, "android_release_certificate_subject", certificate.ready, {
    expected: EXPECTED_ANDROID_CERTIFICATE_SUBJECT,
    subject: certificate.subject,
    issue: certificate.issue,
  });
  if (!certificate.ready) issues.push(certificate.issue);
}

function loadIosIdentity(root) {
  const local = parseProperties(read(root, "apps/mobile/ios/Flutter/LocalIdentity.xcconfig"));
  const release = parseProperties(read(root, "apps/mobile/ios/Flutter/Release.xcconfig"));
  const debug = parseProperties(read(root, "apps/mobile/ios/Flutter/Debug.xcconfig"));
  return {
    TRANSLATION_IOS_BUNDLE_ID:
      process.env.TRANSLATION_IOS_BUNDLE_ID ||
      local.TRANSLATION_IOS_BUNDLE_ID ||
      release.TRANSLATION_IOS_BUNDLE_ID ||
      debug.TRANSLATION_IOS_BUNDLE_ID ||
      "",
    TRANSLATION_IOS_DEVELOPMENT_TEAM:
      process.env.TRANSLATION_IOS_DEVELOPMENT_TEAM ||
      local.TRANSLATION_IOS_DEVELOPMENT_TEAM ||
      release.TRANSLATION_IOS_DEVELOPMENT_TEAM ||
      debug.TRANSLATION_IOS_DEVELOPMENT_TEAM ||
      "",
  };
}

function resolveIosBuildSetting(value, identity) {
  let resolved = value.replace(/^"|"$/g, "");
  for (const [name, replacement] of Object.entries(identity)) {
    resolved = resolved.replaceAll(`$(${name})`, replacement);
  }
  return resolved.trim();
}

function loadAndroidReleaseProperties(root) {
  return parseProperties(read(root, "apps/mobile/android/key.properties"));
}

function resolveAndroidApplicationId(gradle, releaseProperties) {
  const configuredValue = androidReleaseValue(releaseProperties, "applicationId");
  if (configuredValue) return configuredValue;
  const literal = gradle.match(/applicationId\s*=\s*"([^"]+)"/)?.[1];
  if (literal) return literal;
  return gradle.match(/applicationId\s*=\s*releaseString\("applicationId",\s*"([^"]+)"\)/)?.[1] ?? "";
}

function androidSigningStatus(root, releaseProperties) {
  const names = ["storeFile", "storePassword", "keyAlias", "keyPassword"];
  const values = Object.fromEntries(names.map((name) => [name, androidReleaseValue(releaseProperties, name)]));
  const missing = names.filter((name) => !values[name]);
  const storeFileExists = Boolean(values.storeFile && androidStoreFilePath(root, values.storeFile));
  if (values.storeFile && !storeFileExists) missing.push("storeFileExists");
  return { ready: missing.length === 0, missing, storeFileExists };
}

function androidCertificateSubjectStatus(root, releaseProperties, options) {
  const storeFile = androidReleaseValue(releaseProperties, "storeFile");
  const storePassword = androidReleaseValue(releaseProperties, "storePassword");
  const keyAlias = androidReleaseValue(releaseProperties, "keyAlias");
  const storeFilePath = storeFile ? androidStoreFilePath(root, storeFile) : "";
  if (!storeFile || !storePassword || !keyAlias || !storeFilePath) {
    return {
      ready: false,
      subject: "",
      issue: "Android release certificate subject cannot be checked without complete signing properties.",
    };
  }
  const reader = options.androidCertificateSubjectReader ?? readAndroidCertificateSubject;
  const result = reader({ storeFilePath, storePassword, keyAlias });
  if (!result.ok) {
    return {
      ready: false,
      subject: result.subject ?? "",
      issue: "Android release certificate subject could not be read.",
    };
  }
  const subject = result.subject ?? "";
  const ready = subject.includes(EXPECTED_ANDROID_CERTIFICATE_SUBJECT);
  return {
    ready,
    subject,
    issue: ready
      ? ""
      : `Android release certificate subject must include ${EXPECTED_ANDROID_CERTIFICATE_SUBJECT}.`,
  };
}

function readAndroidCertificateSubject({ storeFilePath, storePassword, keyAlias }) {
  const result = spawnSync("keytool", [
    "-list",
    "-v",
    "-keystore",
    storeFilePath,
    "-storepass",
    storePassword,
    "-alias",
    keyAlias,
  ], { encoding: "utf8" });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const subject = output.match(/(?:Owner|Subject):\s*([^\n]+)/)?.[1]?.trim() ?? "";
  return { ok: result.status === 0 && Boolean(subject), subject };
}

function androidReleaseValue(releaseProperties, name) {
  return (process.env[androidReleaseEnvName(name)] || releaseProperties[name] || "").trim();
}

function androidReleaseEnvName(name) {
  return `TRANSLATION_ANDROID_${name.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`;
}

function androidStoreFilePath(root, storeFile) {
  if (path.isAbsolute(storeFile)) return existsSync(storeFile) ? storeFile : "";
  return [
    path.join(root, "apps/mobile/android", storeFile),
    path.join(root, "apps/mobile/android/app", storeFile),
  ].find((candidate) => existsSync(candidate)) ?? "";
}

function parseProperties(content) {
  const properties = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (match) properties[match[1]] = match[2].trim();
  }
  return properties;
}

function requireText(checks, issues, name, content, needles) {
  const missing = needles.filter((needle) => !content.includes(needle));
  record(checks, name, missing.length === 0, { missing });
  issues.push(...missing.map((needle) => `${name} missing ${needle}`));
}

function requireAbsent(checks, issues, name, content, needles) {
  const present = needles.filter((needle) => content.includes(needle));
  record(checks, name, present.length === 0, { present });
  issues.push(...present.map((needle) => `${name} contains ${needle}`));
}

function record(checks, name, ok, details) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}

function read(root, relativePath) {
  const file = path.join(root, relativePath);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}
