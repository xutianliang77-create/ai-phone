import { describe, expect, it, vi } from "vitest";
import { discloseAndGenerateReply } from "./voice-agent-disclosure.js";

describe("Voice Agent disclosure lifecycle", () => {
  it("does not generate a reply when the callee disconnects during disclosure", async () => {
    let resolveClose!: () => void;
    let resolvePlayout!: () => void;
    let closed = false;
    const close = new Promise<void>((resolve) => { resolveClose = resolve; });
    const playout = new Promise<void>((resolve) => { resolvePlayout = resolve; });
    const session = {
      say: vi.fn(() => ({ waitForPlayout: () => playout })),
      resumeReplyAuthorization: vi.fn(),
      generateReply: vi.fn(),
    };
    const report = vi.fn(async () => {});
    const running = discloseAndGenerateReply({
      session,
      disclosureText: "我是AI助手。",
      replyInstructions: "继续任务。",
      closed: close,
      isClosed: () => closed,
      report,
    });

    closed = true;
    resolveClose();
    resolvePlayout();

    await expect(running).resolves.toBe(false);
    expect(report).toHaveBeenCalledWith("disclosure_started");
    expect(report).not.toHaveBeenCalledWith("disclosure_completed");
    expect(session.resumeReplyAuthorization).not.toHaveBeenCalled();
    expect(session.generateReply).not.toHaveBeenCalled();
  });

  it("generates exactly one reply only after completed playout", async () => {
    const session = {
      say: vi.fn(() => ({ waitForPlayout: vi.fn(async () => {}) })),
      resumeReplyAuthorization: vi.fn(),
      generateReply: vi.fn(),
    };
    const report = vi.fn(async () => {});

    await expect(discloseAndGenerateReply({
      session,
      disclosureText: "我是AI助手。",
      replyInstructions: "继续任务。",
      closed: new Promise<void>(() => {}),
      isClosed: () => false,
      report,
    })).resolves.toBe(true);

    expect(report.mock.calls.map(([event]) => event)).toEqual([
      "disclosure_started",
      "disclosure_completed",
    ]);
    expect(session.resumeReplyAuthorization).toHaveBeenCalledOnce();
    expect(session.generateReply).toHaveBeenCalledOnce();
  });
});
