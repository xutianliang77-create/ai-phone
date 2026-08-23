import { describe, expect, it } from "vitest";
import {
  validateAdmissionEvents,
  validateUnavailableHealth,
} from "../run_wujie_dependency_fault_smoke.mjs";

describe("Wujie dependency fault smoke gates", () => {
  it("accepts a fail-closed translation admission error", () => {
    expect(validateAdmissionEvents([{
      type: "error",
      code: "provider_unavailable",
      stage: "translation",
      retryable: true,
    }])).toMatchObject({ stage: "translation" });
  });

  it("rejects session start and ambiguous provider errors", () => {
    expect(() => validateAdmissionEvents([{
      type: "session.started",
    }, {
      type: "error",
      code: "provider_unavailable",
      stage: "provider",
      retryable: true,
    }])).toThrow(/session.started/u);
  });

  it("requires unavailable health and HTTP 503 release readiness", () => {
    expect(() => validateUnavailableHealth({
      status: "unavailable",
      dependencyReadiness: { sessionReady: false },
    }, 503)).not.toThrow();
    expect(() => validateUnavailableHealth({
      status: "ok",
      dependencyReadiness: { sessionReady: true },
    }, 200)).toThrow(/gateway status/u);
  });
});
