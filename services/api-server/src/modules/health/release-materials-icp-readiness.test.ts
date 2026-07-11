import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { getReleaseMaterialsReadiness } from "./release-materials-readiness.js";
import {
  readyManifest,
  writeManifest,
} from "./release-materials-readiness-test-helpers.js";

describe("release materials APP ICP readiness", () => {
  const tempDirs: string[] = [];
  const previous = process.env.RELEASE_MATERIALS_FILE;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.RELEASE_MATERIALS_FILE;
    } else {
      process.env.RELEASE_MATERIALS_FILE = previous;
    }
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { force: true, recursive: true });
    }
  });

  it("accepts the configured draft filing for development gates", () => {
    process.env.RELEASE_MATERIALS_FILE = writeManifest(
      tempDirs,
      readyManifest({ appIcpFiling: "京ICP备00000000号-1A" }),
    );

    const readiness = getReleaseMaterialsReadiness();

    expect(readiness.status).toBe("ready");
    expect(readiness.issues).toEqual([]);
    expect(readiness.warnings).toContain(
      "release materials draft APP ICP filing accepted for development; replace before formal submission",
    );
  });

  it("rejects unapproved placeholder filings", () => {
    process.env.RELEASE_MATERIALS_FILE = writeManifest(
      tempDirs,
      readyManifest({ appIcpFiling: "京ICP备00000000号-2A" }),
    );

    const readiness = getReleaseMaterialsReadiness();

    expect(readiness.status).toBe("not_ready");
    expect(readiness.issues).toContain(
      "release materials placeholder APP ICP filing",
    );
  });
});
