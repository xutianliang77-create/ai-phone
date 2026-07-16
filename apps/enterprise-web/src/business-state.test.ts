import { describe, expect, it } from "vitest";
import { EnterpriseApiError } from "./api/enterprise-api.js";
import {
  apiErrorState,
  providerCapabilityState,
  tenantJobState,
} from "./business-state.js";

describe("enterprise business state adapters", () => {
  it("maps provider truth without inventing a success page state", () => {
    expect(providerCapabilityState("not_configured")).toBe("not_ready");
    expect(providerCapabilityState("not_ready")).toBe("not_ready");
    expect(providerCapabilityState("checking")).toBe("processing");
    expect(providerCapabilityState("degraded")).toBe("degraded");
    expect(providerCapabilityState("ready")).toBe("ready");
  });

  it("maps server jobs and optimistic-concurrency errors", () => {
    expect(tenantJobState("processing")).toBe("processing");
    expect(tenantJobState("failed")).toBe("failed");
    expect(tenantJobState("completed")).toBe("ready");
    expect(apiErrorState(new EnterpriseApiError(409, "conflict", "Conflict")))
      .toBe("conflict");
    expect(apiErrorState(new EnterpriseApiError(412, "version", "Version")))
      .toBe("conflict");
    expect(apiErrorState(new EnterpriseApiError(403, "denied", "Denied")))
      .toBe("forbidden");
  });
});
