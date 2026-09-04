import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const installScript = readFileSync(
  new URL("../install_ios_profile_test.sh", import.meta.url),
  "utf8",
);
const diagnosticsReport = readFileSync(
  new URL(
    "../../apps/mobile/lib/src/features/device_asr/data/core_ml_nemotron_diagnostics_report.dart",
    import.meta.url,
  ),
  "utf8",
);

describe("iOS profile install contract", () => {
  it("validates and forwards the selected realtime mode", () => {
    expect(installScript).toContain(
      'REALTIME_MODE="${REALTIME_MODE:-conversation}"',
    );
    expect(installScript).toContain(
      "conversation|meeting|classroom|business",
    );
    expect(installScript).toContain(
      '--dart-define="REALTIME_MODE=$REALTIME_MODE"',
    );
  });

  it("bypasses local proxies for the direct server health gate", () => {
    expect(installScript).toContain(
      "curl --noproxy '*' --fail --silent --show-error",
    );
  });

  it("fails fast when the iPhone is locked and bounds device commands", () => {
    expect(installScript).toContain(
      'DEVICE_COMMAND_TIMEOUT_SECONDS="${DEVICE_COMMAND_TIMEOUT_SECONDS:-30}"',
    );
    expect(installScript).toContain(
      'DEVICE_COMMAND_ATTEMPTS="${DEVICE_COMMAND_ATTEMPTS:-2}"',
    );
    expect(installScript).toContain("device info lockState");
    expect(installScript).toContain("result.passcodeRequired");
    expect(installScript).toContain("iPhone must be unlocked");
    expect(installScript.match(/if ! require_unlocked_device/g)).toHaveLength(2);
    expect(installScript).toContain('--timeout "$DEVICE_COMMAND_TIMEOUT_SECONDS"');
  });

  it("uses one release identity for the bundle and Dart UI", () => {
    expect(installScript).toContain(
      'APP_VERSION="${APP_VERSION:-$PUBSPEC_APP_VERSION}"',
    );
    expect(installScript).toContain(
      'BUILD_NUMBER="${BUILD_NUMBER:-$PUBSPEC_BUILD_NUMBER}"',
    );
    expect(installScript).toContain('--build-name="$APP_VERSION"');
    expect(installScript).toContain('--build-number="$BUILD_NUMBER"');
    expect(installScript).toContain(
      '--dart-define="APP_VERSION=$APP_VERSION"',
    );
    expect(installScript).toContain(
      '--dart-define="BUILD_NUMBER=$BUILD_NUMBER"',
    );
    expect(diagnosticsReport).toContain(
      "String.fromEnvironment(\n    'BUILD_NUMBER',",
    );
    expect(diagnosticsReport).not.toContain("'APP_BUILD_NUMBER'");
  });
});
