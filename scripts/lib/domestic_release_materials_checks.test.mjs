import { describe, expect, test } from "vitest";
import { appendReleaseMaterialsReadiness } from "./domestic_release_materials_checks.mjs";

describe("appendReleaseMaterialsReadiness", () => {
  test("records ready release materials", async () => {
    const context = baseContext({
      checkFn: async () => ({
        status: "ready",
        manifestPath: "release/domestic/release-materials.json",
        checkedItems: ["app_identity", "legal_entity"],
        issues: [],
        actions: [],
      }),
    });

    await appendReleaseMaterialsReadiness(context);

    expect(context.checks).toEqual([{
      name: "release_materials_readiness",
      status: "pass",
      details: {
        status: "ready",
        manifestPath: "release/domestic/release-materials.json",
        checkedItems: ["app_identity", "legal_entity"],
      },
    }]);
    expect(context.issues).toEqual([]);
  });

  test("aggregates incomplete release materials issues", async () => {
    const context = baseContext({
      checkFn: async () => ({
        status: "not_ready",
        manifestPath: undefined,
        checkedItems: [],
        issues: ["release materials missing RELEASE_MATERIALS_FILE"],
        actions: ["Fill release materials."],
      }),
    });

    await appendReleaseMaterialsReadiness(context);

    expect(context.checks[0]).toMatchObject({
      name: "release_materials_readiness",
      status: "fail",
      details: { status: "not_ready" },
    });
    expect(context.issues).toContain("release_materials_readiness is not ready.");
    expect(context.issues).toContain("release materials missing RELEASE_MATERIALS_FILE");
    expect(context.actions).toContain("Fill release materials.");
  });

  test("records an explicit skipped check", async () => {
    const context = baseContext({ enabled: false });

    await appendReleaseMaterialsReadiness(context);

    expect(context.checks).toEqual([{
      name: "release_materials_readiness",
      status: "pass",
      details: { skipped: true },
    }]);
  });
});

function baseContext(overrides = {}) {
  return {
    enabled: true,
    root: "/repo",
    file: "",
    timeoutMs: 1000,
    checks: [],
    issues: [],
    actions: [],
    record: (checks, name, ok, details = {}) => {
      checks.push({ name, status: ok ? "pass" : "fail", details });
    },
    normalizeIssues: (issues) => issues ?? [],
    ...overrides,
  };
}
