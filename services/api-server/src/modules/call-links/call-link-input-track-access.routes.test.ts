import { describe, expect, it } from "vitest";
import { parseCallInputTrackAccessRequest } from
  "./call-link-input-track-access.routes.js";

describe("call input track access request", () => {
  it("accepts an exact worker, dispatch, participant, and track binding", () => {
    expect(parseCallInputTrackAccessRequest(request())).toEqual(request());
  });

  it.each([
    ["workerIdentity", ""],
    ["dispatchGeneration", 0],
    ["participantIdentity", ""],
    ["trackSid", ""],
    ["trackName", ""],
  ])("rejects invalid %s", (key, value) => {
    expect(parseCallInputTrackAccessRequest({ ...request(), [key]: value }))
      .toBeNull();
  });

  it("rejects extra authority claims", () => {
    expect(parseCallInputTrackAccessRequest({
      ...request(),
      speakerRole: "guest",
    })).toBeNull();
  });
});

function request() {
  return {
    workerIdentity: "call-1:worker:translation-1",
    dispatchGeneration: 4,
    participantIdentity: "call-1:guest:air:air-780-1",
    trackSid: "TR_air_1",
    trackName: "air780-downlink-air-780-1",
  };
}
