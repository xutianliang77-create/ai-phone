import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import { PlatformMixedLoadCommandDriver } from
  "./platform_mixed_load_command_driver.mjs";

const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("PlatformMixedLoadCommandDriver", () => {
  it("executes without a shell and passes bounded session context", async () => {
    const outputDirectory = temporaryDirectory();
    const driver = new PlatformMixedLoadCommandDriver({
      root: process.cwd(),
      outputDirectory,
      config: {
        safety: { gracefulDrainSeconds: 5 },
        systemProbe: jsonCommand({
          observedUtilization: 0.86,
          oomCount: 0,
          unboundedQueueObserved: false,
        }),
      },
    });
    const command = {
      file: process.execPath,
      args: ["-e", `process.stdout.write(JSON.stringify({
        schemaVersion: 1,
        status: "passed",
        sessionId: process.env.PLATFORM_LOAD_SESSION_ID,
        kinds: process.env.PLATFORM_LOAD_TRAFFIC_KINDS
      }))`],
    };

    const result = await driver.runSession({
      runId: "run-1",
      phase: "capacity-25",
      phaseType: "capacity",
      sessionId: "session-1",
      scenario: { name: "translation", trafficKinds: ["api", "livekit"] , command },
      targetConcurrency: 25,
      durationMs: 100,
      apiBaseUrl: "http://127.0.0.1:3410",
    });

    expect(result).toMatchObject({
      status: "passed",
      sessionId: "session-1",
      kinds: "api,livekit",
    });
    expect(JSON.parse(readFileSync(
      path.join(outputDirectory, "commands/capacity-25-session-1.json"),
      "utf8",
    ))).toEqual(result);
    expect(await driver.sampleSystem({
      runId: "run-1",
      phase: "admission",
      targetConcurrency: 120,
    })).toMatchObject({ observedUtilization: 0.86, oomCount: 0 });
    await driver.shutdown();
  });

  it("rejects non-JSON attestations", async () => {
    const driver = new PlatformMixedLoadCommandDriver({
      root: process.cwd(),
      outputDirectory: temporaryDirectory(),
      config: { safety: { gracefulDrainSeconds: 5 } },
    });

    await expect(driver.execute({
      file: process.execPath,
      args: ["-e", "process.stdout.write('not-json')"],
    }, {
      label: "invalid",
      timeoutMs: 1000,
      env: {},
    })).rejects.toThrow("did not emit one JSON document");
  });
});

function jsonCommand(value) {
  return {
    file: process.execPath,
    args: ["-e", `process.stdout.write(${JSON.stringify(JSON.stringify(value))})`],
  };
}

function temporaryDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), "mixed-load-driver-"));
  directories.push(directory);
  return directory;
}
