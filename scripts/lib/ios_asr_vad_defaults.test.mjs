import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("iOS device ASR stable VAD defaults", () => {
  for (const relativePath of [
    "scripts/ios_nemotron_device_smoke.sh",
    "scripts/ios_nemotron_mvp_smoke.sh",
  ]) {
    it(`locks stable defaults in ${relativePath}`, () => {
      const content = readFileSync(path.resolve(relativePath), "utf8");
      expect(content).toContain(
        'DEVICE_ASR_ENDPOINT_MIN_SPEECH_MS="${DEVICE_ASR_ENDPOINT_MIN_SPEECH_MS:-600}"',
      );
      expect(content).toContain(
        'DEVICE_ASR_VAD_PROVIDER="${DEVICE_ASR_VAD_PROVIDER:-fluidaudio_silero}"',
      );
      expect(content).toContain(
        'DEVICE_ASR_VAD_THRESHOLD="${DEVICE_ASR_VAD_THRESHOLD:-0.6}"',
      );
      expect(content).toContain(
        'DEVICE_ASR_VAD_NEGATIVE_THRESHOLD="${DEVICE_ASR_VAD_NEGATIVE_THRESHOLD:-0.35}"',
      );
      expect(content).toContain(
        'DEVICE_ASR_VAD_PRE_ROLL_MS="${DEVICE_ASR_VAD_PRE_ROLL_MS:-800}"',
      );
    });
  }

  it("passes VAD and capture defaults into the iOS build", () => {
    const content = readFileSync(
      path.resolve("scripts/ios_nemotron_device_smoke.sh"),
      "utf8",
    );
    for (const key of [
      "DEVICE_ASR_VAD_PROVIDER",
      "DEVICE_ASR_VAD_THRESHOLD",
      "DEVICE_ASR_VAD_NEGATIVE_THRESHOLD",
      "DEVICE_ASR_VAD_PRE_ROLL_MS",
      "DEVICE_ASR_DIAGNOSTIC_CAPTURE",
    ]) {
      expect(content).toContain(`--dart-define=${key}="$${key}"`);
    }
  });
});
