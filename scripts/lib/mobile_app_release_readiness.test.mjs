import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { checkMobileAppReleaseReadiness } from "./mobile_app_release_readiness.mjs";

let tempDir = null;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("checkMobileAppReleaseReadiness", () => {
  test("passes release mobile metadata", () => {
    tempDir = makeProject();

    const result = checkMobileAppReleaseReadiness(tempDir, {
      chineseInterfaceCheck: readyChineseInterface,
      androidCertificateSubjectReader: qkxyCertificateSubject,
    });

    expect(result.status).toBe("ready");
    expect(result.issues).toEqual([]);
  });

  test("blocks example ids, debug signing, and release cleartext", () => {
    tempDir = makeProject({
      androidApplicationId: "com.example.translation_mobile",
      androidReleaseSigning: false,
      androidReleaseDebugSigning: true,
      androidReleaseCleartext: true,
      iosBundleId: "com.example.translationMobile",
    });

    const result = checkMobileAppReleaseReadiness(tempDir, {
      chineseInterfaceCheck: readyChineseInterface,
      androidCertificateSubjectReader: qkxyCertificateSubject,
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain("Android applicationId still uses com.example or is not configured.");
    expect(result.issues).toContain("Android release build still signs with debug keys.");
    expect(result.issues).toContain("Android release signing properties are missing or invalid.");
    expect(result.issues).toContain(
      "android_release_cleartext_disabled contains usesCleartextTraffic=\"true\"",
    );
    expect(result.issues).toContain(
      "iOS PRODUCT_BUNDLE_IDENTIFIER still uses com.example or is not configured.",
    );
  });

  test("blocks missing compliance support and account entries", () => {
    tempDir = makeProject({ complianceCenter: "隐私政策 用户协议 权限用途说明" });

    const result = checkMobileAppReleaseReadiness(tempDir, {
      chineseInterfaceCheck: readyChineseInterface,
      androidCertificateSubjectReader: qkxyCertificateSubject,
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain("mobile_compliance_center missing 客服与账户");
    expect(result.issues).toContain("mobile_compliance_center missing support@qkxy.cn");
    expect(result.issues).toContain("mobile_compliance_center missing 删除账号");
  });

  test("blocks Android release certificates from another legal entity", () => {
    tempDir = makeProject();

    const result = checkMobileAppReleaseReadiness(tempDir, {
      chineseInterfaceCheck: readyChineseInterface,
      androidCertificateSubjectReader: otherCertificateSubject,
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "Android release certificate subject must include 北京乾坤祥云科技有限公司.",
    );
  });

  test("blocks public Android purchase actions before domestic payment is ready", () => {
    tempDir = makeProject({
      walletPage: `
if (_platform == TargetPlatform.android &&
    product.providers.contains('wechat_pay')) {
  return 'wechat_pay';
}
`,
    });

    const result = checkMobileAppReleaseReadiness(tempDir, {
      chineseInterfaceCheck: readyChineseInterface,
      androidCertificateSubjectReader: qkxyCertificateSubject,
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain("mobile_android_payment_hidden missing TargetPlatform.iOS");
    expect(result.issues).toContain(
      "mobile_android_payment_not_exposed contains TargetPlatform.android",
    );
  });

  test("blocks missing Android system ASR fallback wiring", () => {
    tempDir = makeProject({ androidSystemAsrBridge: "" });

    const result = checkMobileAppReleaseReadiness(tempDir, {
      chineseInterfaceCheck: readyChineseInterface,
      androidCertificateSubjectReader: qkxyCertificateSubject,
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "mobile_android_system_asr_native_bridge missing SpeechRecognizer",
    );
    expect(result.issues).toContain(
      "mobile_android_system_asr_native_bridge missing RecognitionListener",
    );
  });

  test("blocks missing iOS restore purchase wiring", () => {
    tempDir = makeProject({
      walletPage: "String? _paymentProviderFor(product) => 'apple_iap';",
      purchaseService: "abstract interface class PurchaseService {}",
      storeKitBridge: "final class StoreKitBridge {}",
    });

    const result = checkMobileAppReleaseReadiness(tempDir, {
      chineseInterfaceCheck: readyChineseInterface,
      androidCertificateSubjectReader: qkxyCertificateSubject,
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "mobile_ios_restore_purchase_surface missing restorePurchases",
    );
    expect(result.issues).toContain(
      'mobile_ios_storekit_restore_bridge missing case "restorePurchases"',
    );
  });
});

function readyChineseInterface() {
  return { status: "ready", failures: [] };
}

function qkxyCertificateSubject() {
  return {
    ok: true,
    subject: "CN=北京乾坤祥云科技有限公司, O=北京乾坤祥云科技有限公司, C=CN",
  };
}

function otherCertificateSubject() {
  return { ok: true, subject: "CN=Other Company, O=Other Company, C=CN" };
}

function makeProject(options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "mobile-release-"));
  write(root, "apps/mobile/lib/src/app/region_edition_config.dart", `
const edition = String.fromEnvironment('REGION_EDITION', defaultValue: 'domestic');
const dataRegion = 'cn';
const callProviderPolicy = 'call_link_only';
const complianceProfile = 'pipl';
`);
  write(root, "apps/mobile/lib/src/app/app_config.dart", `
const sourceLanguage = String.fromEnvironment('SOURCE_LANGUAGE', defaultValue: 'auto');
const targetLanguage = String.fromEnvironment('TARGET_LANGUAGE', defaultValue: 'zh');
const useMockAudio = bool.fromEnvironment('USE_MOCK_AUDIO');
`);
  write(root, "apps/mobile/lib/src/platform/asr/android_system_asr_provider.dart",
    options.androidSystemAsrProvider ?? `
class AndroidSystemAsrProvider implements MobileAsrDiagnostics {
  static const channel = 'translation_mobile/system_asr';
  final message = 'Android system ASR ready';
}
`);
  write(root, "apps/mobile/lib/src/features/realtime/presentation/controllers/realtime_runtime_factories.dart",
    options.realtimeRuntimeFactory ?? `
import 'android_system_asr_provider.dart';
Object createDefaultMobileAsrProvider(config) {
  if (config.deviceAsrProvider == 'android_system' ||
      config.deviceAsrProvider == 'system') {
    return AndroidSystemAsrProvider();
  }
}
`);
  write(root, "apps/mobile/lib/src/features/compliance/data/compliance_document.dart",
    options.complianceCenter ?? `
const complianceDocuments = [
  '隐私政策',
  '用户协议',
  '第三方 SDK 与模型服务商清单',
  '权限用途说明',
  '客服与账户',
  'support@qkxy.cn',
  '退款处理',
  '删除账号',
  '隐私反馈',
  'https://app.qkxy.cn/account/delete',
];
`);
  write(root, "apps/mobile/lib/src/features/billing/presentation/pages/wallet_page.dart",
    options.walletPage ?? `
String? _paymentProviderFor(product) {
  if (_platform == TargetPlatform.iOS &&
      _paymentStack.contains('apple_iap') &&
      product.providers.contains('apple_iap')) {
    return 'apple_iap';
  }
  return null;
}
Future<void> _restorePurchases() async {
  await _purchaseService.restorePurchases();
  await _purchaseService.finishTransaction('transaction');
  _message = l10n.restoreSuccess;
  _message = l10n.restoreEmpty;
}
`);
  write(root, "apps/mobile/lib/src/platform/billing/purchase_service.dart",
    options.purchaseService ?? `
abstract interface class PurchaseService {
  Future restorePurchases();
  Future finishTransaction(String transactionId);
}
`);
  write(root, "apps/mobile/ios/Runner/StoreKitBridge.swift",
    options.storeKitBridge ?? `
final class StoreKitBridge {
  func handle(method: String) {
    switch method {
    case "restorePurchases":
      restorePurchases()
    default:
      break
    }
  }
  func restorePurchases() async {
    try await AppStore.sync()
    _ = Transaction.currentEntitlements
    _ = Transaction.unfinished
  }
}
`);
  write(root, "apps/mobile/ios/Runner/Info.plist", `
<key>NSCameraUsageDescription</key>
<key>NSMicrophoneUsageDescription</key>
<key>NSPhotoLibraryUsageDescription</key>
<key>NSLocalNetworkUsageDescription</key>
`);
  write(root, "apps/mobile/ios/Runner/zh-Hans.lproj/InfoPlist.strings", `
"NSCameraUsageDescription" = "拍照翻译需要使用相机。";
"NSMicrophoneUsageDescription" = "实时同传需要使用麦克风。";
"NSPhotoLibraryUsageDescription" = "拍照翻译需要读取相册。";
"NSLocalNetworkUsageDescription" = "实时同传需要连接局域网。";
`);
  const iosBundleId = options.iosBundleId ?? "com.realtimeinterpreter.app";
  write(root, "apps/mobile/ios/Flutter/Debug.xcconfig", `
TRANSLATION_IOS_BUNDLE_ID=com.example.translationMobile
`);
  write(root, "apps/mobile/ios/Flutter/Release.xcconfig", `
TRANSLATION_IOS_BUNDLE_ID=com.example.translationMobile
`);
  write(root, "apps/mobile/ios/Flutter/LocalIdentity.xcconfig", `
TRANSLATION_IOS_BUNDLE_ID=${iosBundleId}
`);
  write(root, "apps/mobile/ios/Runner.xcodeproj/project.pbxproj", `
PRODUCT_BUNDLE_IDENTIFIER = "$(TRANSLATION_IOS_BUNDLE_ID)";
PRODUCT_BUNDLE_IDENTIFIER = "$(TRANSLATION_IOS_BUNDLE_ID).RunnerTests";
`);
  write(root, "apps/mobile/android/app/src/main/AndroidManifest.xml", `
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.RECORD_AUDIO"/>
<uses-permission android:name="android.permission.CAMERA"/>
<application ${options.androidReleaseCleartext ? 'android:usesCleartextTraffic="true"' : ""}/>
<queries>
  <intent>
    <action android:name="android.speech.RecognitionService"/>
  </intent>
</queries>
</manifest>
`);
  write(root, "apps/mobile/android/app/src/main/kotlin/com/example/translation_mobile/AndroidSystemAsrBridge.kt",
    options.androidSystemAsrBridge ?? `
class AndroidSystemAsrBridge {
  val channel = "translation_mobile/system_asr/events"
  fun start() {
    SpeechRecognizer.createSpeechRecognizer(null)
    requestPermissions()
    scheduleRestart()
  }
}
class RecognitionListener
`);
  write(root, "apps/mobile/android/app/src/debug/AndroidManifest.xml", `
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
<application android:usesCleartextTraffic="true"/>
</manifest>
`);
  write(root, "apps/mobile/android/app/src/profile/AndroidManifest.xml", `
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
<application android:usesCleartextTraffic="true"/>
</manifest>
`);
  if (options.androidReleaseSigning !== false) {
    write(root, "apps/mobile/android/release.jks", "fake keystore");
    write(root, "apps/mobile/android/key.properties", `
applicationId=${options.androidApplicationId ?? "com.realtimeinterpreter.app"}
storeFile=release.jks
storePassword=password
keyAlias=domestic
keyPassword=password
`);
  }
  write(root, "apps/mobile/android/app/build.gradle.kts", `
android {
  defaultConfig {
    applicationId = releaseString("applicationId", "com.example.translation_mobile")
  }
  buildTypes {
    release {
      ${options.androidReleaseDebugSigning ? 'signingConfig = signingConfigs.getByName("debug")' : ""}
    }
  }
}
`);
  return root;
}

function write(root, relativePath, content) {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}
