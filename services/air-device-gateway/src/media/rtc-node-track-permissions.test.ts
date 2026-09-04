import { afterEach, describe, expect, it, vi } from "vitest";
import { setRtcNodeTrackSubscriptionPermissions } from
  "./rtc-node-track-permissions.js";

describe("rtc-node track subscription permission adapter", () => {
  afterEach(() => {
    delete (globalThis as typeof globalThis & {
      _ffiClientInstance?: unknown;
    })._ffiClientInstance;
  });

  it("sends a deny-by-default FFI request with unique identities", () => {
    const request = vi.fn(() => ({}));
    (globalThis as typeof globalThis & {
      _ffiClientInstance?: { request: typeof request };
    })._ffiClientInstance = { request };

    setRtcNodeTrackSubscriptionPermissions(
      { ffi_handle: { handle: 7n } },
      ["session-1:worker:one", "session-1:worker:one"],
    );

    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      message: {
        case: "setTrackSubscriptionPermissions",
        value: {
          localParticipantHandle: 7n,
          allParticipantsAllowed: false,
          permissions: [{
            participantIdentity: "session-1:worker:one",
            allowAll: true,
            allowedTrackSids: [],
          }],
        },
      },
    });
  });

  it("fails closed without the rtc-node FFI instance", () => {
    expect(() => setRtcNodeTrackSubscriptionPermissions(
      { ffi_handle: { handle: 7n } },
      [],
    )).toThrow("permission API is unavailable");
  });
});
