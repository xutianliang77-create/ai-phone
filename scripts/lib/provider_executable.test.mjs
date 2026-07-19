import { describe, expect, it } from "vitest";
import { hashProviderProcessOutput } from "./provider_executable.mjs";

describe("hashProviderProcessOutput", () => {
  it("supports deterministic streaming normalization without persisting stdout", async () => {
    const hash = async (marker) => hashProviderProcessOutput(process.execPath, [
      "-e",
      `process.stdout.write(${JSON.stringify([
        "-- PostgreSQL database dump",
        `\\restrict ${marker}`,
        "CREATE TABLE example (id integer);",
        "",
        "COPY example (id) FROM stdin;",
        "1",
        "\\.",
        `\\unrestrict ${marker}`,
      ].join("\n"))})`,
    ], {
      normalizeLine: (line) =>
        /^--/.test(line) || /^\\(?:un)?restrict\b/.test(line) ? null : line,
    });
    const first = await hash("random-a");
    const second = await hash("random-b");
    expect(first.stdoutSha256).toBe(second.stdoutSha256);
    expect(first.stdoutBytes).toBeGreaterThan(0);
  });
});
