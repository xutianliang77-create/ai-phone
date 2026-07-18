import { describe, expect, it, vi } from "vitest";
import {
  createEnterpriseWorkerDispatchRuntime,
} from "./enterprise-worker-dispatch-runtime.js";

describe("enterprise worker dispatch runtime", () => {
  it("rejects an invalid or expired ticket before opening a tenant transaction", async () => {
    const connect = vi.fn();
    const runtime = createEnterpriseWorkerDispatchRuntime({
      pool: { connect },
      signingSecret: "enterprise-worker-dispatch-secret-32-bytes",
    });

    await expect(runtime.authorizeEffect({
      ticket: "forged.ticket",
      workerCellId: "cn-cell-01",
      workerId: "worker-01",
      traceId: "trace-1",
    })).resolves.toEqual({ status: "invalid_ticket" });
    expect(connect).not.toHaveBeenCalled();
  });

  it("requires an explicit strong shared signing secret", () => {
    expect(() => createEnterpriseWorkerDispatchRuntime({
      pool: { connect: vi.fn() },
      signingSecret: "weak",
    })).toThrow("at least 32 bytes");
  });
});
