import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const installScript = readFileSync(
  new URL("../install_ios_profile_test.sh", import.meta.url),
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
});
