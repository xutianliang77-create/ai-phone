import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BoundedJsonCommandRunner } from "./bounded_json_command_runner.mjs";

const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("BoundedJsonCommandRunner", () => {
  it("passes only allowlisted environment and redacts captured secrets", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "bounded-json-"));
    directories.push(directory);
    process.env.PROVIDER_TEST_ALLOWED = "visible";
    process.env.PROVIDER_TEST_SECRET = "secret-\"value";
    process.env.PROVIDER_TEST_BLOCKED = "blocked";
    const runner = new BoundedJsonCommandRunner({
      root: process.cwd(),
      outputDirectory: directory,
      gracefulDrainSeconds: 1,
    });

    const result = await runner.execute({
      file: process.execPath,
      args: ["-e", [
        "process.stderr.write(process.env.PROVIDER_TEST_SECRET);",
        "console.log(JSON.stringify({",
        "allowed: process.env.PROVIDER_TEST_ALLOWED,",
        "secret: process.env.PROVIDER_TEST_SECRET,",
        "blocked: process.env.PROVIDER_TEST_BLOCKED ?? null",
        "}));",
      ].join("")],
      environmentKeys: ["PROVIDER_TEST_ALLOWED", "PROVIDER_TEST_SECRET"],
    }, {
      label: "environment-test",
      timeoutMs: 5_000,
      env: {},
    });

    expect(result).toEqual({ allowed: "visible", secret: "[REDACTED]", blocked: null });
    const stderr = path.join(directory, "commands/environment-test.stderr.log");
    expect(readFileSync(stderr, "utf8")).toBe("[REDACTED]");
    expect(statSync(stderr).mode & 0o777).toBe(0o600);
  });
});
