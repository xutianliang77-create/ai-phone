import { readyChineseInterface, qkxyCertificateSubject, otherCertificateSubject, makeProject, write } from "./mobile_release_test_fixtures.mjs";
import { rmSync } from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import { checkMobileAppReleaseReadiness } from "./mobile_app_release_readiness.mjs";

let tempDir = null;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("checkMobileAppReleaseReadiness", () => {
  test("iOS-only checks do not require deferred Android release signing", () => {
    tempDir = makeProject({ androidApplicationId: "com.example.translation_mobile", androidReleaseSigning: false });
    const result = checkMobileAppReleaseReadiness(tempDir, { platform: "ios", chineseInterfaceCheck: readyChineseInterface,
      androidCertificateSubjectReader: () => { throw new Error("Android must not be probed"); } });
    expect(result.status).toBe("ready");
    expect(result.checks.some((r) => r.name.startsWith("android_"))).toBe(false);
  });
  test("formal iOS metadata cannot pass when the selected build config still uses the private plist", () => {
    tempDir = makeProject();
    write(tempDir, "apps/mobile/ios/Runner/Info-Formal.plist", `
      <key>NSCameraUsageDescription</key><key>NSMicrophoneUsageDescription</key><key>NSPhotoLibraryUsageDescription</key>
      <key>NSAllowsArbitraryLoads</key><false/><key>NSAllowsLocalNetworking</key><false/>`);
    const options = { platform: "ios", distributionChannel: "app_store", chineseInterfaceCheck: readyChineseInterface };
    expect(checkMobileAppReleaseReadiness(tempDir, options).status).toBe("not_ready");
    write(tempDir, "apps/mobile/ios/Flutter/LocalIdentity.xcconfig", `
      TRANSLATION_IOS_BUNDLE_ID=cn.publisher.translator
      WUJIE_DISTRIBUTION_CHANNEL=app_store
      WUJIE_PRODUCT_PROFILE=core_translation
      WUJIE_INFO_PLIST_SUFFIX=-Formal`);
    expect(checkMobileAppReleaseReadiness(tempDir, options).status).toBe("ready");
  });
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
