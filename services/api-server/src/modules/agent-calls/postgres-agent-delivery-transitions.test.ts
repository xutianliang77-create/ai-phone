import { describe, expect, it } from "vitest";
import type { AgentDeliveryLifecycleEvent } from "@translation/contracts";
import type { AgentDeliveryRecord } from "./agent-delivery-record.js";
import { lifecycleTransition } from
  "./postgres-agent-delivery-transitions.js";

describe("PostgreSQL Agent delivery transitions", () => {
  it("preserves an existing terminal delivery without another mutation", () => {
    const record = {
      status: "playback_ended",
      serverPlaybackState: "ended",
    } as AgentDeliveryRecord;
    const event = {
      type: "agent.delivery.failed",
      failureCode: "late_worker_failure",
    } as AgentDeliveryLifecycleEvent;

    expect(lifecycleTransition(record, event)).toEqual({
      status: "playback_ended",
      serverPlaybackState: "ended",
      terminal: true,
      changed: false,
    });
  });

  it("also ignores a late non-terminal lifecycle event", () => {
    const record = {
      status: "failed",
      serverPlaybackState: "queued",
    } as AgentDeliveryRecord;
    const event = {
      type: "agent.delivery.started",
    } as AgentDeliveryLifecycleEvent;

    expect(lifecycleTransition(record, event)).toEqual({
      status: "failed",
      serverPlaybackState: "queued",
      terminal: true,
      changed: false,
    });
  });
});
