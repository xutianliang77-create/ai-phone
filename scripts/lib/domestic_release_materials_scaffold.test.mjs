import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildDomesticReleaseMaterialsDraft,
  writeDomesticReleaseMaterialsDraft,
} from "./domestic_release_materials_scaffold.mjs";

describe("domestic release materials scaffold", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { force: true, recursive: true });
    }
  });

  test("builds a draft from local mobile release identity", () => {
    const root = makeRoot(tempDirs);
    writeFileSync(
      path.join(root, "apps/mobile/ios/Flutter/LocalIdentity.xcconfig"),
      "TRANSLATION_IOS_BUNDLE_ID=cn.qkxy.realtimeinterpreter\n",
    );
    writeFileSync(
      path.join(root, "apps/mobile/android/key.properties"),
      "applicationId=cn.qkxy.realtimeinterpreter\n",
    );

    const draft = buildDomesticReleaseMaterialsDraft({ root });

    expect(draft.bundleId).toBe("cn.qkxy.realtimeinterpreter");
    expect(draft.androidPackageId).toBe("cn.qkxy.realtimeinterpreter");
    expect(draft.legalEntity).toBe("北京乾坤祥云科技有限公司");
    expect(draft.privacyLabelsCompleted).toBe(false);
    expect(draft.privacyPolicyUrl).toBe("");
    expect(draft.appIcpFiling).toBe("京ICP备00000000号-1A");
    expect(draft.grayReleasePlan).toBe("");
    expect(draft.initialGrayPercent).toBe(5);
    expect(draft.iosScreenshots).toHaveLength(3);
    expect(draft.androidScreenshots).toHaveLength(3);
    expect(draft.iosScreenshots).toContain(
      "release/domestic/screenshots/ios-call.png",
    );
  });

  test("writes a draft and refuses to overwrite by default", () => {
    const root = makeRoot(tempDirs);
    const first = writeDomesticReleaseMaterialsDraft({ root });
    const second = writeDomesticReleaseMaterialsDraft({ root });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.issue).toContain("already exists");
    const written = JSON.parse(readFileSync(first.output, "utf8"));
    expect(written.modelProviderList).toContain("hymt2_self_hosted");
    expect(written.androidScreenshots).toContain(
      "release/domestic/screenshots/android-history.png",
    );
    expect(
      first.remainingRequiredFields.some((field) =>
        field.startsWith("appIcpFiling:"),
      ),
    ).toBe(true);
    expect(first.remainingRequiredFields).toContain("grayReleasePlan");
  });

  test("can overwrite explicitly", () => {
    const root = makeRoot(tempDirs);
    writeDomesticReleaseMaterialsDraft({ root });

    const result = writeDomesticReleaseMaterialsDraft({
      root,
      overwrite: true,
      appName: "中英实时同传",
    });

    expect(result.ok).toBe(true);
    expect(result.manifest.appName).toBe("中英实时同传");
  });
});

function makeRoot(tempDirs) {
  const root = mkdtempSync(
    path.join(tmpdir(), "translation-release-scaffold-"),
  );
  tempDirs.push(root);
  mkdirSync(path.join(root, "apps/mobile/ios/Flutter"), { recursive: true });
  mkdirSync(path.join(root, "apps/mobile/android"), { recursive: true });
  return root;
}
