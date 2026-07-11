import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { checkDomesticReleaseSecretHygiene } from "./domestic_release_secret_hygiene.mjs";

describe("checkDomesticReleaseSecretHygiene", () => {
  const tempDirs = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  test("passes when production env and signing secrets are gitignored", () => {
    const root = createRoot(tempDirs, [
      "release/domestic/release.env",
      "apps/mobile/android/key.properties",
      "apps/mobile/android/release/*.jks",
      "apps/mobile/android/release/*.keystore",
    ]);

    const result = checkDomesticReleaseSecretHygiene({ root });

    expect(result.status).toBe("ready");
    expect(result.issues).toEqual([]);
  });

  test("fails when Android signing secrets are not protected", () => {
    const root = createRoot(tempDirs, [
      "release/domestic/release.env",
      "apps/mobile/android/key.properties",
    ]);

    const result = checkDomesticReleaseSecretHygiene({ root });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "domestic secret hygiene missing ignore pattern: apps/mobile/android/release/*.jks",
    );
    expect(result.issues).toContain(
      "domestic secret hygiene missing ignore pattern: apps/mobile/android/release/*.keystore",
    );
  });
});

function createRoot(tempDirs, gitignorePatterns) {
  const root = mkdtempSync(path.join(tmpdir(), "translation-secret-hygiene-"));
  tempDirs.push(root);
  mkdirSync(path.join(root, "release/domestic"), { recursive: true });
  mkdirSync(path.join(root, "apps/mobile/android"), { recursive: true });
  writeFileSync(
    path.join(root, ".gitignore"),
    `${gitignorePatterns.join("\n")}\n`,
  );
  writeFileSync(path.join(root, "release/domestic/release.env.example"), "");
  writeFileSync(
    path.join(root, "apps/mobile/android/key.properties.example"),
    "",
  );
  return root;
}
