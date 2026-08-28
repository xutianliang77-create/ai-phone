import { describe, expect, it } from "vitest";
import { parseAirDeviceMediaRecoveryRequest } from
  "./air-device-media-recovery.routes.js";

describe("Air device media recovery request", () => {
  it("accepts one exact fully fenced active-call binding", () => {
    expect(parseAirDeviceMediaRecoveryRequest(binding())).toEqual(binding());
  });

  it.each([
    ["fencingToken", 0],
    ["callGeneration", -1],
    ["deviceId", ""],
    ["providerCallId", "bad value"],
  ])("rejects invalid %s", (key, value) => {
    expect(parseAirDeviceMediaRecoveryRequest({
      ...binding(),
      [key]: value,
    })).toBeNull();
  });

  it("rejects extra fields so a recovery request cannot carry a DIAL target", () => {
    expect(parseAirDeviceMediaRecoveryRequest({
      ...binding(),
      phoneNumberReference: "+8613800138000",
    })).toBeNull();
  });
});

function binding() {
  return {
    communicationSessionId: "comm-1",
    providerCallId: "air-call-1",
    deviceId: "air-780-1",
    leaseId: "lease-1",
    fencingToken: 7,
    callGeneration: 3,
  };
}
