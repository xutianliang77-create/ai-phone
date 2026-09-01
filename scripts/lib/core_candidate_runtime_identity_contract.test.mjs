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

  test("checks live port ownership before creating the remote candidate", () => {
    const preflight = script.lastIndexOf("preflight\nrequire_clean_source");
    const portCheck = script.indexOf("require_remote_ports_free", preflight);
    const remoteMkdir = script.indexOf('mkdir -p \'$REMOTE_SOURCE\'', portCheck);
    expect(portCheck).toBeGreaterThan(preflight);
    expect(remoteMkdir).toBeGreaterThan(portCheck);
  });

  test("blocks deployment and status on a host running Maruko resources", () => {
    expect(script).toContain("require_remote_resource_isolation");
    expect(script).toContain("running Maruko containers found");
    expect(script).toContain("running Maruko process found");
    expect(script).toContain("Maruko listener found");
    const deployStart = script.lastIndexOf("preflight\nrequire_clean_source");
    const isolation = script.indexOf(
      "require_remote_resource_isolation",
      deployStart,
    );
    const sourceBuild = script.indexOf("run check:source-build", isolation);
    expect(isolation).toBeGreaterThan(deployStart);
    expect(sourceBuild).toBeGreaterThan(isolation);
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

  test("keeps the advertised realtime endpoint and handshake host in lockstep", () => {
    expect(script).toContain(
      'set_env REALTIME_WS_ENDPOINT "ws://$PUBLIC_HOST:$REALTIME_PORT/realtime"',
    );
    expect(script).toContain(
      'set_env REALTIME_ALLOWED_HOSTS "$PUBLIC_HOST:$REALTIME_PORT"',
    );
    expect(script).toContain(
      "candidate Gateway does not allow its advertised realtime host",
    );
    expect(script).toContain(
      'set_env REALTIME_ALLOW_NON_BROWSER_CLIENTS_WITHOUT_ORIGIN true',
    );
  });
});
