import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { configureAndroidReleaseKeystore } from "./android_release_keystore_config.mjs";

let tempDir = null;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("configureAndroidReleaseKeystore", () => {
  test("dry run builds redacted keytool command without writing files", () => {
    tempDir = makeRoot();

    const result = configureAndroidReleaseKeystore(tempDir, {
      ...validOptions(),
      dryRun: true,
    }, fakeKeytool());

    expect(result.status).toBe("ready");
    expect(result.written).toEqual([]);
    expect(result.keytoolCommand.args).toContain("***");
    expect(existsSync(path.join(tempDir, "apps/mobile/android/key.properties"))).toBe(false);
    expect(result.androidCertificateDname).toBe(
      "CN=北京乾坤祥云科技有限公司, O=北京乾坤祥云科技有限公司, C=CN",
    );
  });

  test("generates keystore and writes Android key properties", () => {
    tempDir = makeRoot();
    const runner = fakeKeytool({ writesKeystore: true });

    const result = configureAndroidReleaseKeystore(tempDir, validOptions(), runner);

    expect(result.status).toBe("ready");
    expect(result.written).toHaveLength(2);
    expect(runner.calls[0].args).toContain("-genkeypair");
    expect(read("apps/mobile/android/key.properties")).toContain(
      "applicationId=cn.qkxy.realtimeinterpreter",
    );
    expect(read("apps/mobile/android/key.properties")).toContain("storeFile=release/domestic-release.jks");
  });

  test("rejects placeholders, weak passwords, and existing keystore without overwrite", () => {
    tempDir = makeRoot({ existingKeystore: true });

    const result = configureAndroidReleaseKeystore(tempDir, {
      applicationId: "com.example.translation",
      storePassword: "short",
      keyPassword: "short",
      keyAlias: "replace-with-key",
    }, fakeKeytool());

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain("Android applicationId must be a real lowercase reverse-DNS id.");
    expect(result.issues).toContain("Android storePassword must be at least 12 characters.");
    expect(result.issues).toContain("Android keyAlias must be a real release key alias.");
    expect(result.issues).toContain("Android release keystore already exists; pass --overwrite to replace it.");
  });

  test("overwrites an existing keystore when explicitly requested", () => {
    tempDir = makeRoot({ existingKeystore: true });
    const runner = fakeKeytool({ writesKeystore: true });

    const result = configureAndroidReleaseKeystore(tempDir, {
      ...validOptions(),
      overwrite: true,
    }, runner);

    expect(result.status).toBe("ready");
    expect(result.written).toContain(
      path.join(tempDir, "apps/mobile/android/release/domestic-release.jks"),
    );
    expect(read("apps/mobile/android/key.properties")).toContain("keyAlias=domestic");
  });
});

function validOptions() {
  return {
    applicationId: "cn.qkxy.realtimeinterpreter",
    storeFile: "release/domestic-release.jks",
    storePassword: "store-secret-123",
    keyAlias: "domestic",
    keyPassword: "key-secret-123",
    companyName: "北京乾坤祥云科技有限公司",
  };
}

function fakeKeytool(options = {}) {
  const runner = (command, args) => {
    runner.calls.push({ command, args });
    if (options.writesKeystore) {
      const file = args[args.indexOf("-keystore") + 1];
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, "fake keystore");
    }
    return { status: options.status ?? 0 };
  };
  runner.calls = [];
  return runner;
}

function makeRoot(options = {}) {
  const root = path.join(tmpdir(), `android-keystore-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  tempDir = root;
  if (options.existingKeystore) {
    const file = path.join(root, "apps/mobile/android/release/domestic-release.jks");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "existing");
  }
  return root;
}

function read(relativePath) {
  return readFileSync(path.join(tempDir, relativePath), "utf8");
}
