import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

describe("formal identity selects the secure plist", () => {
  const dirs = [];
  afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true }); });
  function write(channel, profile = "core_translation") {
    const dir = mkdtempSync(path.join(tmpdir(), "v10-formal-identity-")); dirs.push(dir);
    const output = path.join(dir, "identity.xcconfig");
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("write_ios_build_identity_xcconfig.mjs", import.meta.url)), output], {
      env: { ...process.env, WUJIE_CANDIDATE_ID: "v10-formal-test", WUJIE_SOURCE_COMMIT: "a".repeat(40),
        WUJIE_SOURCE_TREE: "b".repeat(40), WUJIE_SOURCE_STATE: "clean", WUJIE_PRODUCT_PROFILE: profile,
        WUJIE_DISTRIBUTION_CHANNEL: channel }, encoding: "utf8" });
    return { result, output };
  }
  it("keeps legacy private builds and new formal builds distinct", () => {
    const formal = write("app_store");
    expect(formal.result.status).toBe(0);
    expect(readFileSync(formal.output, "utf8")).toContain("WUJIE_INFO_PLIST_SUFFIX=-Formal");
    const legacy = write("restricted_instance");
    expect(legacy.result.status).toBe(0);
    expect(readFileSync(legacy.output, "utf8")).toContain("WUJIE_INFO_PLIST_SUFFIX=\n");
  });
  it.each([["app_store", "full"], ["unknown", "core_translation"]])("refuses invalid inputs before writing %s/%s", (channel, profile) => {
    const { result, output } = write(channel, profile);
    expect(result.status).not.toBe(0); expect(existsSync(output)).toBe(false);
  });
  it("preserves base identity and permissions while removing formal cleartext exceptions", () => {
    const ios = fileURLToPath(new URL("../../apps/mobile/ios/", import.meta.url));
    const checked = JSON.parse(execFileSync("/usr/bin/python3", ["-c", `
import plistlib,json,pathlib
p=pathlib.Path(${JSON.stringify(ios)})
a=plistlib.loads((p/'Runner/Info.plist').read_bytes())
b=plistlib.loads((p/'Runner/Info-Formal.plist').read_bytes())
print(json.dumps({'changed':[k for k in set(a)|set(b) if a.get(k)!=b.get(k)],'ats':b['NSAppTransportSecurity']}))
`], { encoding: "utf8" }));
    expect(checked.changed.sort()).toEqual(["NSAppTransportSecurity", "NSLocalNetworkUsageDescription"]);
    expect(checked.ats).toEqual({ NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: false });
  });
});
