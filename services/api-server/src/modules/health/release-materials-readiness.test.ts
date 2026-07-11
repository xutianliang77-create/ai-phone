import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getReleaseMaterialsReadiness,
  getReleaseMaterialsReadinessForFile,
} from "./release-materials-readiness.js";
import {
  minimalPng,
  readyManifest,
  writeManifest,
} from "./release-materials-readiness-test-helpers.js";

describe("release materials readiness", () => {
  const tempDirs: string[] = [];
  const previous = process.env.RELEASE_MATERIALS_FILE;
  const previousCwd = process.cwd();

  afterEach(() => {
    process.chdir(previousCwd);
    if (previous === undefined) {
      delete process.env.RELEASE_MATERIALS_FILE;
    } else {
      process.env.RELEASE_MATERIALS_FILE = previous;
    }
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { force: true, recursive: true });
    }
  });

  it("fails when no manifest is configured", () => {
    delete process.env.RELEASE_MATERIALS_FILE;

    const readiness = getReleaseMaterialsReadiness();

    expect(readiness.status).toBe("not_ready");
    expect(readiness.issues).toContain(
      "release materials missing RELEASE_MATERIALS_FILE",
    );
  });

  it("fails when the manifest cannot be read", () => {
    process.env.RELEASE_MATERIALS_FILE = "/missing/release-materials.json";

    const readiness = getReleaseMaterialsReadiness();

    expect(readiness.status).toBe("not_ready");
    expect(readiness.issues).toContain("release materials unreadable manifest");
  });

  it("reports missing required domestic release items", () => {
    process.env.RELEASE_MATERIALS_FILE = writeManifest(tempDirs, {
      appName: "ai phone",
      privacyPolicyUrl: "http://example.cn/privacy",
      sdkList: [],
    });

    const readiness = getReleaseMaterialsReadiness();

    expect(readiness.status).toBe("not_ready");
    expect(readiness.issues).toContain(
      "release materials missing APP ICP filing",
    );
    expect(readiness.issues).toContain(
      "release materials missing legal entity",
    );
    expect(readiness.issues).toContain(
      "release materials invalid privacy policy url",
    );
    expect(readiness.issues).toContain(
      "release materials placeholder privacy policy url",
    );
    expect(readiness.issues).toContain("release materials missing SDK list");
    expect(readiness.issues).toContain(
      "release materials privacy labels not completed",
    );
  });

  it("passes with completed domestic release materials", () => {
    process.env.RELEASE_MATERIALS_FILE = writeManifest(
      tempDirs,
      readyManifest(),
    );

    const readiness = getReleaseMaterialsReadiness();

    expect(readiness.status).toBe("ready");
    expect(readiness.issues).toEqual([]);
    expect(readiness.checkedItems).toContain("app_icp_filing");
    expect(readiness.checkedItems).toContain("model_provider_list");
    expect(readiness.checkedItems).toContain("gray_release_plan");
  });

  it("can validate an explicit manifest path without environment variables", () => {
    delete process.env.RELEASE_MATERIALS_FILE;
    const manifestPath = writeManifest(tempDirs, readyManifest());

    const readiness = getReleaseMaterialsReadinessForFile(manifestPath);

    expect(readiness.status).toBe("ready");
    expect(readiness.manifestPath).toBe(manifestPath);
  });

  it("accepts project-root-relative screenshot paths", () => {
    const root = mkdtempSync(join(tmpdir(), "translation-release-root-"));
    tempDirs.push(root);
    const serviceDir = join(root, "services/api-server");
    mkdirSync(serviceDir, { recursive: true });
    process.chdir(serviceDir);
    const screenshotDir = join(root, "release/domestic/screenshots");
    mkdirSync(screenshotDir, { recursive: true });
    for (const item of [
      "android-main",
      "android-call",
      "android-history",
      "ios-main",
      "ios-call",
      "ios-history",
    ]) {
      writeFileSync(join(screenshotDir, `${item}.png`), minimalPng(390, 844));
    }
    const manifestPath = join(root, "release/domestic/release-materials.json");
    writeFileSync(
      manifestPath,
      JSON.stringify(
        readyManifest({
          androidScreenshots: [
            "release/domestic/screenshots/android-main.png",
            "release/domestic/screenshots/android-call.png",
            "release/domestic/screenshots/android-history.png",
          ],
          iosScreenshots: [
            "release/domestic/screenshots/ios-main.png",
            "release/domestic/screenshots/ios-call.png",
            "release/domestic/screenshots/ios-history.png",
          ],
        }),
      ),
    );

    const readiness = getReleaseMaterialsReadinessForFile(manifestPath);

    expect(readiness.status).toBe("ready");
  });

  it("fails when the manifest uses placeholder identities or missing screenshots", () => {
    process.env.RELEASE_MATERIALS_FILE = writeManifest(
      tempDirs,
      readyManifest({
        androidPackageId: "cn.example.translation",
        appIcpFiling: "京ICP备00000000号-1A",
        customerSupportEmail: "support@example.cn",
        iosScreenshots: ["screenshots/missing-ios.png"],
      }),
    );

    const readiness = getReleaseMaterialsReadiness();

    expect(readiness.status).toBe("not_ready");
    expect(readiness.issues).toContain(
      "release materials placeholder Android package id",
    );
    expect(readiness.issues).not.toContain(
      "release materials placeholder APP ICP filing",
    );
    expect(readiness.issues).not.toContain(
      "release materials invalid APP ICP filing",
    );
    expect(readiness.issues).toContain(
      "release materials placeholder customer support",
    );
    expect(readiness.issues).toContain(
      "release materials missing iOS screenshot file: screenshots/missing-ios.png",
    );
  });

  it("fails when an APP ICP filing is real-looking but invalid", () => {
    process.env.RELEASE_MATERIALS_FILE = writeManifest(
      tempDirs,
      readyManifest({
        appIcpFiling: "备案申请中",
      }),
    );

    const readiness = getReleaseMaterialsReadiness();

    expect(readiness.status).toBe("not_ready");
    expect(readiness.issues).toContain(
      "release materials invalid APP ICP filing",
    );
  });

  it("fails when completed materials do not match domestic app baselines", () => {
    process.env.RELEASE_MATERIALS_FILE = writeManifest(
      tempDirs,
      readyManifest({
        accountDeletionUrl: "https://app.qkxy.cn/delete-account",
        androidPackageId: "cn.qkxy.other",
        bundleId: "cn.qkxy.other",
        customerSupportEmail: "help@qkxy.cn",
        legalEntity: "北京其他科技有限公司",
        privacyPolicyUrl: "https://legal.qkxy.cn/privacy",
        refundPolicyUrl: "https://legal.qkxy.cn/refund",
        userAgreementUrl: "https://legal.qkxy.cn/terms",
      }),
    );

    const readiness = getReleaseMaterialsReadiness();

    expect(readiness.status).toBe("not_ready");
    expect(readiness.checkedItems).toContain("domestic_baseline_alignment");
    expect(readiness.issues).toContain(
      "release materials legal entity must match 北京乾坤祥云科技有限公司",
    );
    expect(readiness.issues).toContain(
      "release materials customer support must match support@qkxy.cn",
    );
    expect(readiness.issues).toContain(
      "release materials account deletion url must match https://app.qkxy.cn/account/delete",
    );
    expect(readiness.issues).toContain(
      "release materials privacy policy url must match https://app.qkxy.cn/privacy",
    );
    expect(readiness.issues).toContain(
      "release materials refund policy url must match https://app.qkxy.cn/refund",
    );
    expect(readiness.issues).toContain(
      "release materials user agreement url must match https://app.qkxy.cn/terms",
    );
  });

  it("fails when a local screenshot file is not a PNG or JPEG image", () => {
    process.env.RELEASE_MATERIALS_FILE = writeManifest(
      tempDirs,
      readyManifest({
        iosScreenshots: ["screenshots/ios-main.txt"],
      }),
    );

    const readiness = getReleaseMaterialsReadiness();

    expect(readiness.status).toBe("not_ready");
    expect(readiness.issues).toContain(
      "release materials invalid iOS screenshot image: screenshots/ios-main.txt",
    );
  });

  it("fails when a local screenshot image is too small to be a store screenshot", () => {
    process.env.RELEASE_MATERIALS_FILE = writeManifest(
      tempDirs,
      readyManifest({
        iosScreenshots: ["screenshots/ios-tiny.png"],
      }),
    );

    const readiness = getReleaseMaterialsReadiness();

    expect(readiness.status).toBe("not_ready");
    expect(readiness.issues).toContain(
      "release materials invalid iOS screenshot image: screenshots/ios-tiny.png",
    );
  });

  it("fails when a remote screenshot URL is not HTTPS", () => {
    process.env.RELEASE_MATERIALS_FILE = writeManifest(
      tempDirs,
      readyManifest({
        iosScreenshots: ["http://cdn.qkxy.cn/ios-main.png"],
      }),
    );

    const readiness = getReleaseMaterialsReadiness();

    expect(readiness.status).toBe("not_ready");
    expect(readiness.issues).toContain(
      "release materials invalid iOS screenshot url: http://cdn.qkxy.cn/ios-main.png",
    );
  });

  it("fails when store screenshot counts are too low", () => {
    process.env.RELEASE_MATERIALS_FILE = writeManifest(
      tempDirs,
      readyManifest({
        androidScreenshots: ["screenshots/android-main.png"],
        iosScreenshots: ["screenshots/ios-main.png"],
      }),
    );

    const readiness = getReleaseMaterialsReadiness();

    expect(readiness.status).toBe("not_ready");
    expect(readiness.issues).toContain(
      "release materials needs at least 3 Android screenshots",
    );
    expect(readiness.issues).toContain(
      "release materials needs at least 3 iOS screenshots",
    );
  });

  it("fails when gray release plan or initial percent is missing", () => {
    process.env.RELEASE_MATERIALS_FILE = writeManifest(
      tempDirs,
      readyManifest({
        grayReleasePlan: "",
        initialGrayPercent: undefined,
      }),
    );

    const readiness = getReleaseMaterialsReadiness();

    expect(readiness.status).toBe("not_ready");
    expect(readiness.issues).toContain(
      "release materials missing gray release plan",
    );
    expect(readiness.issues).toContain(
      "release materials missing initial gray percent",
    );
  });

  it("fails when the initial gray percent is outside the safe launch range", () => {
    process.env.RELEASE_MATERIALS_FILE = writeManifest(
      tempDirs,
      readyManifest({
        initialGrayPercent: 50,
      }),
    );

    const readiness = getReleaseMaterialsReadiness();

    expect(readiness.status).toBe("not_ready");
    expect(readiness.issues).toContain(
      "release materials invalid initial gray percent",
    );
  });
});
