import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasRtcNodeParticipantHandle,
  RtcNodeTtsTrackPermissions,
} from "./rtc-node-tts-track-permissions.js";

describe("RTC-node TTS track permissions", () => {
  afterEach(() => {
    delete (globalThis as typeof globalThis & {
      _ffiClientInstance?: unknown;
    })._ffiClientInstance;
  });

  it("denies all subscribers before granting one exact target track", () => {
    const request = vi.fn(() => ({}));
    (globalThis as typeof globalThis & {
      _ffiClientInstance?: unknown;
    })._ffiClientInstance = { request };
    const permissions = new RtcNodeTtsTrackPermissions({
      ffi_handle: { handle: 42n },
    });

    permissions.denyAll();
    permissions.allowTrack("comm-1:guest:air:air-780-1", "TR_tts_1");

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      message: {
        case: "setTrackSubscriptionPermissions",
        value: { localParticipantHandle: 42n, allParticipantsAllowed: false,
          permissions: [] },
      },
    });
    expect(request.mock.calls[1]?.[0]).toMatchObject({
      message: {
        case: "setTrackSubscriptionPermissions",
        value: {
          localParticipantHandle: 42n,
          allParticipantsAllowed: false,
          permissions: [{
            participantIdentity: "comm-1:guest:air:air-780-1",
            allowAll: false,
            allowedTrackSids: ["TR_tts_1"],
          }],
        },
      },
    });
  });

  it("rejects missing FFI and malformed target claims", () => {
    const permissions = new RtcNodeTtsTrackPermissions({
      ffi_handle: { handle: 42n },
    });
    expect(() => permissions.denyAll()).toThrow("permission API is unavailable");
    expect(() => permissions.allowTrack("", "TR_tts_1"))
      .toThrow("target identity is invalid");
    expect(() => permissions.allowTrack("guest", "bad sid"))
      .toThrow("track SID is invalid");
  });

  it("accepts only rtc-node local participant handles", () => {
    expect(hasRtcNodeParticipantHandle({ ffi_handle: { handle: 1n } })).toBe(true);
    expect(hasRtcNodeParticipantHandle({ ffi_handle: { handle: 1 } })).toBe(false);
    expect(hasRtcNodeParticipantHandle(undefined)).toBe(false);
  });
});
