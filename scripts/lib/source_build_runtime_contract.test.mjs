import { describe, expect, it } from "vitest";

import { hasLockedLinuxFfmpegRuntime } from
  "./source_build_runtime_contract.mjs";

const dockerfile = `RUN npm ci && \\
  test -x node_modules/@ffmpeg-installer/linux-x64/ffmpeg`;

describe("source build runtime contract", () => {
  it("accepts the locked optional dependency installed by npm ci", () => {
    expect(hasLockedLinuxFfmpegRuntime(JSON.stringify({
      optionalDependencies: { "@ffmpeg-installer/linux-x64": "4.1.0" },
    }), dockerfile)).toBe(true);
  });

  it.each([
    ["missing pin", JSON.stringify({}), dockerfile],
    ["floating pin", JSON.stringify({
      optionalDependencies: { "@ffmpeg-installer/linux-x64": "^4.1.0" },
    }), dockerfile],
    ["missing binary check", JSON.stringify({
      optionalDependencies: { "@ffmpeg-installer/linux-x64": "4.1.0" },
    }), "RUN npm ci"],
    ["invalid package json", "not-json", dockerfile],
  ])("rejects %s", (_label, manifest, source) => {
    expect(hasLockedLinuxFfmpegRuntime(manifest, source)).toBe(false);
  });
});
