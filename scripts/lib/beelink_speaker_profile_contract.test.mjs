import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const modelScript = readFileSync(
  new URL("../deploy_beelink_model_services.sh", import.meta.url),
  "utf8",
);

describe("Beelink speaker profile contract", () => {
  it("preserves the accepted 100ms onset and short-gap profile", () => {
    expect(modelScript).toContain('"SPEAKER_PAD_OFFSET_MS=0"');
    expect(modelScript).toContain('"SPEAKER_MIN_DURATION_ON_MS=100"');
    expect(modelScript).toContain('"SPEAKER_MIN_DURATION_OFF_MS=320"');
  });
});
