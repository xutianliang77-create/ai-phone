import { describe, expect, it } from "vitest";
import { startWithReplyAuthorizationPaused } from
  "./agent-session-start-gate.js";

describe("Agent session start gate", () => {
  it("starts the session before pausing reply authorization", async () => {
    const calls: string[] = [];
    let running = false;
    await startWithReplyAuthorizationPaused({
      async start() {
        calls.push("start");
        running = true;
      },
      pauseReplyAuthorization() {
        if (!running) throw new Error("AgentSession is not running");
        calls.push("pause");
      },
    }, { agent: "test" });

    expect(calls).toEqual(["start", "pause"]);
  });
});
