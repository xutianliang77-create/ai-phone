import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
    expect(script).toContain('PUBLIC_IOS_BUNDLE_ID="${PUBLIC_IOS_BUNDLE_ID:-}"');
    expect(script).toContain("PUBLIC_IOS_BUNDLE_ID must not reuse the private 1.0 bundle identifier");
    expect(script).toContain('TRANSLATION_IOS_BUNDLE_ID="$PUBLIC_IOS_BUNDLE_ID"');
    expect(script).toContain('TRANSLATION_IOS_DEVELOPMENT_TEAM="$PUBLIC_IOS_DEVELOPMENT_TEAM"');
    expect(script).toContain('--dart-define="WUJIE_CANDIDATE_ID=$CANDIDATE_ID"');
    expect(script).toContain('--dart-define="SOURCE_COMMIT=$SOURCE_COMMIT"');
    expect(script).toContain('--dart-define="SOURCE_TREE=$SOURCE_TREE"');
    expect(script).toContain('--dart-define="SOURCE_STATE=clean"');
    expect(script).toContain('--dart-define="WUJIE_PRODUCT_PROFILE=$PRODUCT_PROFILE"');
    expect(script).toContain('--dart-define="AUTOMATIC_LANGUAGE_PAIR=$AUTOMATIC_LANGUAGE_PAIR"');
    expect(identity).toContain("RegExp(r'^[a-f0-9]{40}$')");
  });

  it("verifies signing, signed plist identity and app aggregate without installing", () => {
    expect(script).toContain('codesign --verify --deep --strict "$APP_PATH"');
    expect(script).toContain('ditto "$APP_PATH" "$ARCHIVED_APP"');
    expect(script).toContain('codesign --verify --deep --strict "$ARCHIVED_APP"');
    expect(script).toContain("Print :WujieCandidateId");
    expect(script).toContain("Print :WujieSourceCommit");
    expect(script).toContain("Print :WujieSourceTree");
    expect(script).toContain("Print :WujieProductProfile");
    expect(infoPlist).toContain("$(WUJIE_CANDIDATE_ID)");
    expect(infoPlist).toContain("$(WUJIE_SOURCE_COMMIT)");
    expect(infoPlist).toContain("$(WUJIE_PRODUCT_PROFILE)");
    expect(xcconfigWriter).toContain("WUJIE_SOURCE_STATE=${sourceState}");
    expect(xcconfigWriter).toContain("TRANSLATION_IOS_BUNDLE_ID=${bundleId}");
    expect(xcconfigWriter).toContain("TRANSLATION_IOS_DEVELOPMENT_TEAM=${developmentTeam}");
    expect(writer).toContain("appAggregateSha256: required(\"APP_SHA256\")");
    expect(writer).toContain("automaticPair: process.env.AUTOMATIC_LANGUAGE_PAIR || null");
    expect(script).not.toContain("devicectl device install app");
    expect(script).not.toContain("devicectl device process launch");
  });

  it("keeps the server address configurable and rejects loopback", () => {
    expect(script).toContain('SERVER_BASE_URL="${SERVER_BASE_URL:-}"');
    expect(script).toContain("SERVER_BASE_URL must be reachable from the iPhone");
  });

  it("writes an explicit public signing identity into the candidate xcconfig", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "wujie-ios-identity-"));
    const output = path.join(directory, "LocalIdentity.xcconfig");
    try {
      execFileSync(process.execPath, [
        fileURLToPath(
          new URL("./write_ios_build_identity_xcconfig.mjs", import.meta.url),
        ),
        output,
      ], {
        env: {
          ...process.env,
          TRANSLATION_IOS_BUNDLE_ID: "cn.qkxy.wujieai.public",
          TRANSLATION_IOS_DEVELOPMENT_TEAM: "5YR3BKMQ62",
          WUJIE_CANDIDATE_ID: "wujie-ios-38e8b2a-2026091502",
          WUJIE_SOURCE_COMMIT: "38e8b2a58d8250370775df695295ee6f0560769f",
          WUJIE_SOURCE_TREE: "39c4a441887830648bdf2ae56d9a3b705b732af3",
          WUJIE_SOURCE_STATE: "clean",
          WUJIE_PRODUCT_PROFILE: "core_translation",
        },
      });
      expect(readFileSync(output, "utf8")).toContain(
        "TRANSLATION_IOS_BUNDLE_ID=cn.qkxy.wujieai.public",
      );
      expect(readFileSync(output, "utf8")).toContain(
        "TRANSLATION_IOS_DEVELOPMENT_TEAM=5YR3BKMQ62",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
