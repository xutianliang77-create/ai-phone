import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    expect(script).toContain('PUBLIC_DEPLOYMENT_ID="${PUBLIC_DEPLOYMENT_ID:-}"');
    expect(script).toContain('IOS_LOCAL_PROFILE="$ROOT_DIR/release/public/1.1.0/ios-device-development.json"');
    expect(script).toContain('--dart-define-from-file="$IOS_LOCAL_PROFILE"');
    expect(script).toContain('IOS_LOCAL_PROFILE_SHA256="$(shasum -a 256 "$IOS_LOCAL_PROFILE"');
    expect(script).toContain("PUBLIC_IOS_BUNDLE_ID must not reuse the private 1.0 bundle identifier");
    expect(script).toContain('TRANSLATION_IOS_BUNDLE_ID="$PUBLIC_IOS_BUNDLE_ID"');
    expect(script).toContain('TRANSLATION_IOS_DEVELOPMENT_TEAM="$PUBLIC_IOS_DEVELOPMENT_TEAM"');
    expect(script).toContain('--dart-define="WUJIE_CANDIDATE_ID=$CANDIDATE_ID"');
    expect(script).toContain('--dart-define="SOURCE_COMMIT=$SOURCE_COMMIT"');
    expect(script).toContain('--dart-define="SOURCE_TREE=$SOURCE_TREE"');
    expect(script).toContain('--dart-define="SOURCE_STATE=clean"');
    expect(script).toContain('--dart-define="WUJIE_PRODUCT_PROFILE=$PRODUCT_PROFILE"');
    expect(script).toContain('--dart-define="PUBLIC_DEPLOYMENT_ID=$PUBLIC_DEPLOYMENT_ID"');
    expect(script).not.toContain('--dart-define="SERVER_OWNED_HISTORY=true"');
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
    expect(writer).toContain('publicDeploymentId: required("PUBLIC_DEPLOYMENT_ID")');
    expect(writer).toContain('iosLocalProfileSha256: required("IOS_LOCAL_PROFILE_SHA256")');
    expect(writer).toContain("automaticPair: process.env.AUTOMATIC_LANGUAGE_PAIR || null");
    expect(script).not.toContain("devicectl device install app");
    expect(script).not.toContain("devicectl device process launch");
  });

  it("keeps the server address configurable and rejects loopback", () => {
    expect(script).toContain('SERVER_BASE_URL="${SERVER_BASE_URL:-}"');
    expect(script).toContain("SERVER_BASE_URL must be reachable from the iPhone");
  });

  it("keeps the declared file aggregate stable across archive locations but detects changed bytes", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "wujie-ios-hash-"));
    const first = path.join(directory, "first", "Runner.app");
    const second = path.join(directory, "moved", "Runner.app");
    const assignment = script.split("\n").find(line => line.startsWith("APP_SHA256="));
    expect(assignment).toContain('cd "$ARCHIVED_APP"');
    expect(assignment).toContain("LC_ALL=C sort -z");
    expect(script).toContain("APP_HASH_ALGORITHM=sha256-relative-regular-files-v1");
    expect(writer).toContain("appAggregateHashAlgorithm");
    const hash = root => execFileSync("bash", ["-c",
      'set -euo pipefail\nARCHIVED_APP="$1"\n' + assignment + '\nprintf "%s" "$APP_SHA256"',
      "ios-hash-test", root], { encoding: "utf8" }).trim();
    try {
      mkdirSync(first, { recursive: true });
      writeFileSync(path.join(first, "Runner"), "synthetic executable");
      writeFileSync(path.join(first, "resource with space"), "synthetic resource");
      cpSync(first, second, { recursive: true });
      const original = hash(first);
      expect(original).toMatch(/^[a-f0-9]{64}$/);
      expect(hash(second)).toBe(original);
      writeFileSync(path.join(second, "Runner"), "changed executable");
      expect(hash(second)).not.toBe(original);
    } finally { rmSync(directory, { recursive: true, force: true }); }
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
