import { describe, expect, it, vi } from "vitest";
import { StickyProviderFallbackController } from
  "./provider-fallback-controller.js";

describe("StickyProviderFallbackController", () => {
  it("keeps sessions sticky and admits one recovery probe after cooldown", async () => {
    let now = 1000;
    const onTransition = vi.fn();
    const controller = new StickyProviderFallbackController({
      stage: "translation",
      primary: { provider: "primary", model: "model-a" },
      fallback: { provider: "fallback", model: "model-b" },
      failureThreshold: 1,
      cooldownMs: 500,
      nowMs: () => now,
      onTransition,
    });

    expect(controller.open("call-1")).toBe("primary");
    await expect(controller.primaryFailed(
      "call-1",
      new Error("Translation provider returned HTTP 503"),
    )).resolves.toBe(true);
    expect(controller.route("call-1")).toBe("fallback");
    expect(controller.open("call-2")).toBe("fallback");

    now = 1501;
    expect(controller.open("call-3")).toBe("primary");
    expect(controller.open("call-4")).toBe("fallback");
    await controller.primarySucceeded("call-3");
    expect(controller.route("call-4")).toBe("fallback");
    expect(controller.open("call-5")).toBe("primary");
    expect(onTransition.mock.calls.map(([event]) => event.state))
      .toEqual(["degraded", "restored"]);
  });

  it("does not degrade for external cancellation or non-retryable 4xx", async () => {
    const controller = new StickyProviderFallbackController({
      stage: "tts",
      primary: { provider: "primary" },
      fallback: { provider: "fallback" },
      failureThreshold: 1,
      cooldownMs: 500,
    });
    controller.open("call-1");
    await expect(controller.primaryFailed(
      "call-1",
      new Error("HTTP TTS returned HTTP 401"),
    )).resolves.toBe(false);
    const abort = new AbortController();
    abort.abort(new Error("superseded"));
    await expect(controller.primaryFailed(
      "call-1",
      new DOMException("aborted", "AbortError"),
      abort.signal,
    )).resolves.toBe(false);
    expect(controller.route("call-1")).toBe("primary");
  });
});
