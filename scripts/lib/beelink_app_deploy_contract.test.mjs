import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  new URL("../deploy_beelink_app_services.sh", import.meta.url),
  "utf8",
);

describe("Beelink app deployment contract", () => {
  it("builds before freezing writes and migrates before enabling SQLite", () => {
    expectInOrder([
      'remote_compose "build"',
      'remote_compose "stop gateway api"',
      "api-store.json.backup-$backup_stamp",
      "npm run storage:migrate-json",
      "npm run storage:check",
      "npm run storage:backup",
      "set_env API_STORAGE_DRIVER sqlite",
      'remote_compose "up -d --no-build --remove-orphans"',
    ]);
  });

  it("preserves an existing database before a fresh JSON migration", () => {
    expect(script).toContain("api-store.sqlite.pre-migration-$backup_stamp");
    expect(script).not.toContain("rm -f '$REMOTE_RUNTIME/data/api-store.sqlite'");
  });

  it("routes authorized voice identity calls to the speaker service", () => {
    expect(script).toContain(
      "VOICE_IDENTITY_HTTP_BASE_URL=http://127.0.0.1:8022",
    );
    expect(script).toContain(
      'set_env VOICE_IDENTITY_HTTP_BASE_URL "http://127.0.0.1:8022"',
    );
    expect(script).toContain('set_env VOICE_IDENTITY_HTTP_TIMEOUT_MS "15000"');
  });
});

function expectInOrder(markers) {
  let previous = -1;
  for (const marker of markers) {
    const index = script.indexOf(marker);
    expect(index, marker).toBeGreaterThan(previous);
    previous = index;
  }
}
