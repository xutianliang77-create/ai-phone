import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { configureMobileReleaseIdentity } from "./mobile_release_identity_config.mjs";

let tempDir = null;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("configureMobileReleaseIdentity", () => {
  test("writes iOS and Android release identity files", () => {
    tempDir = makeRoot();

    const result = configureMobileReleaseIdentity(tempDir, validOptions());

    expect(result.status).toBe("ready");
    expect(result.issues).toEqual([]);
    expect(result.written).toHaveLength(2);
    expect(result.androidCertificateDname).toBe(
      "CN=北京乾坤祥云科技有限公司, O=北京乾坤祥云科技有限公司, C=CN",
    );
    expect(read("apps/mobile/ios/Flutter/LocalIdentity.xcconfig")).toContain(
      "TRANSLATION_IOS_BUNDLE_ID=cn.qkxy.realtimeinterpreter",
    );
    expect(read("apps/mobile/android/key.properties")).toContain(
      "applicationId=cn.qkxy.realtimeinterpreter",
    );
  });

  test("dry run validates without writing files", () => {
    tempDir = makeRoot();

    const result = configureMobileReleaseIdentity(tempDir, {
      ...validOptions(),
      dryRun: true,
    });

    expect(result.status).toBe("ready");
    expect(result.written).toEqual([]);
    expect(existsSync(path.join(tempDir, "apps/mobile/android/key.properties"))).toBe(false);
  });

  test("rejects placeholder ids and missing keystore", () => {
    tempDir = makeRoot({ createKeystore: false });

    const result = configureMobileReleaseIdentity(tempDir, {
      ...validOptions(),
      iosBundleId: "com.example.translationMobile",
      iosTeamId: "YOURTEAMID",
      androidApplicationId: "com.example.translation_mobile",
      androidStoreFile: "missing.jks",
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "iOS bundle id must be a real reverse-DNS id and not com.example/com.yourcompany.",
    );
    expect(result.issues).toContain("iOS development team id must be a 10-character Apple Team ID.");
    expect(result.issues).toContain("Android applicationId must be a real lowercase reverse-DNS id.");
    expect(result.issues).toContain("Android storeFile must point to an existing release keystore.");
  });
});

function validOptions() {
  return {
    iosBundleId: "cn.qkxy.realtimeinterpreter",
    iosTeamId: "ABCDE12345",
    androidApplicationId: "cn.qkxy.realtimeinterpreter",
    androidStoreFile: "release.jks",
    androidStorePassword: "store-secret",
    androidKeyAlias: "domestic",
    androidKeyPassword: "key-secret",
    companyName: "北京乾坤祥云科技有限公司",
  };
}

function makeRoot(options = {}) {
  const root = mkTemp();
  if (options.createKeystore !== false) {
    write("apps/mobile/android/release.jks", "fake keystore", root);
  }
  return root;
}

function mkTemp() {
  const root = path.join(tmpdir(), `mobile-identity-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function read(relativePath) {
  return readFileSync(path.join(tempDir, relativePath), "utf8");
}

function write(relativePath, content, root = tempDir) {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}
