import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  new URL("../build_traceable_ios_candidate.sh", import.meta.url),
  "utf8",
);
const identity = readFileSync(
  new URL("../../apps/mobile/lib/src/app/app_build_identity.dart", import.meta.url),
  "utf8",
);
const writer = readFileSync(
  new URL("./write_ios_candidate_manifest.mjs", import.meta.url),
  "utf8",
);
const xcconfigWriter = readFileSync(
  new URL("./write_ios_build_identity_xcconfig.mjs", import.meta.url),
  "utf8",
);
const infoPlist = readFileSync(
  new URL("../../apps/mobile/ios/Runner/Info.plist", import.meta.url),
  "utf8",
);

describe("traceable iOS candidate contract", () => {
  it("requires clean full source identity and embeds every field", () => {
    expect(script).toContain("status --porcelain=v1 --untracked-files=all");
    expect(script).toContain('git -C "$ROOT_DIR" diff --quiet');
    expect(script).toContain('--dart-define="WUJIE_CANDIDATE_ID=$CANDIDATE_ID"');
    expect(script).toContain('--dart-define="SOURCE_COMMIT=$SOURCE_COMMIT"');
    expect(script).toContain('--dart-define="SOURCE_TREE=$SOURCE_TREE"');
    expect(script).toContain('--dart-define="SOURCE_STATE=clean"');
    expect(identity).toContain("RegExp(r'^[a-f0-9]{40}$')");
  });

  it("verifies signing, signed plist identity and app aggregate without installing", () => {
    expect(script).toContain('codesign --verify --deep --strict "$APP_PATH"');
    expect(script).toContain('ditto "$APP_PATH" "$ARCHIVED_APP"');
    expect(script).toContain('codesign --verify --deep --strict "$ARCHIVED_APP"');
    expect(script).toContain("Print :WujieCandidateId");
    expect(script).toContain("Print :WujieSourceCommit");
    expect(script).toContain("Print :WujieSourceTree");
    expect(infoPlist).toContain("$(WUJIE_CANDIDATE_ID)");
    expect(infoPlist).toContain("$(WUJIE_SOURCE_COMMIT)");
    expect(xcconfigWriter).toContain("WUJIE_SOURCE_STATE=${sourceState}");
    expect(writer).toContain("appAggregateSha256: required(\"APP_SHA256\")");
    expect(script).not.toContain("devicectl device install app");
    expect(script).not.toContain("devicectl device process launch");
  });

  it("keeps the server address configurable and rejects loopback", () => {
    expect(script).toContain('SERVER_BASE_URL="${SERVER_BASE_URL:-}"');
    expect(script).toContain("SERVER_BASE_URL must be reachable from the iPhone");
  });
});
