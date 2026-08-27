import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const script = readFileSync(
  new URL("../deploy_beelink_core_candidate.sh", import.meta.url),
  "utf8",
);

describe("core candidate runtime identity deployment contract", () => {
  test("refuses to sync a dirty source checkout", () => {
    expect(script).toContain("require_clean_source");
    expect(script).toContain("status --porcelain --untracked-files=normal");
    const preflight = script.lastIndexOf("preflight\nrequire_clean_source");
    const sync = script.indexOf("rsync -az --delete", preflight);
    expect(preflight).toBeGreaterThanOrEqual(0);
    expect(sync).toBeGreaterThan(preflight);
  });

  test("freezes source, image, and canonical config identity before start", () => {
    for (const key of [
      "WUJIE_REQUIRE_TRACEABLE_RUNTIME",
      "WUJIE_RUNTIME_CANDIDATE_ID",
      "WUJIE_RUNTIME_SOURCE_COMMIT",
      "WUJIE_RUNTIME_SOURCE_TREE",
      "WUJIE_RUNTIME_IMAGE_ID",
      "WUJIE_RUNTIME_CONFIG_SHA256",
    ]) {
      expect(script).toContain(key);
    }
    expect(script).toContain("docker image inspect");
    expect(script).toContain(
      "grep -v '^WUJIE_RUNTIME_CONFIG_SHA256='",
    );
    const build = script.lastIndexOf('remote_compose "build"');
    const inspect = script.indexOf("docker image inspect", build);
    const start = script.indexOf(
      'remote_compose "up -d --no-build --remove-orphans"',
      inspect,
    );
    expect(build).toBeGreaterThanOrEqual(0);
    expect(inspect).toBeGreaterThan(build);
    expect(start).toBeGreaterThan(inspect);
  });

  test("writes a non-secret manifest and verifies Gateway identity against it", () => {
    expect(script).toContain("candidate-manifest.json");
    expect(script).toContain("environmentFileSha256");
    expect(script).toContain("runtime?.traceable !== true");
    expect(script).toContain(
      "candidate runtime ${runtimeKey} does not match manifest",
    );
  });
});
