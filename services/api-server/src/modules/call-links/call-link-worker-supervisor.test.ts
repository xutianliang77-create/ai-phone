import { describe, expect, it, vi } from "vitest";
import {
  CallLinkWorkerSupervisor,
  type ManagedCallLinkWorkerProcess,
} from "./call-link-worker-supervisor.js";

describe("CallLinkWorkerSupervisor", () => {
  it("launches one worker for concurrent entry requests", async () => {
    const process = new FakeWorkerProcess();
    const launch = vi.fn(() => process);
    const supervisor = new CallLinkWorkerSupervisor(launch, 1_000);

    const first = supervisor.ensure("call-1");
    const second = supervisor.ensure("call-1");
    supervisor.markReady("call-1");

    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(launch).toHaveBeenCalledTimes(1);
    supervisor.stop("call-1");
    expect(process.killedWith).toEqual(["SIGTERM"]);
  });

  it("rejects entry when the worker exits before joining", async () => {
    const process = new FakeWorkerProcess();
    const supervisor = new CallLinkWorkerSupervisor(() => process, 1_000);

    const readiness = supervisor.ensure("call-2");
    process.exit(1, null);

    await expect(readiness).rejects.toThrow("exited (1)");
  });

  it("allows a replacement worker after the prior worker exits", async () => {
    const processes = [new FakeWorkerProcess(), new FakeWorkerProcess()];
    const launch = vi.fn(() => processes.shift()!);
    const supervisor = new CallLinkWorkerSupervisor(launch, 1_000);

    const first = supervisor.ensure("call-3");
    supervisor.markReady("call-3");
    await first;
    const firstProcess = launch.mock.results[0]!.value;
    firstProcess.exit(0, null);

    const second = supervisor.ensure("call-3");
    supervisor.markReady("call-3");
    await second;
    expect(launch).toHaveBeenCalledTimes(2);
    supervisor.stop("call-3");
  });
});

class FakeWorkerProcess implements ManagedCallLinkWorkerProcess {
  private exitListener?: (
    code: number | null,
    signal: NodeJS.Signals | null,
  ) => void;
  private errorListener?: (error: Error) => void;
  readonly killedWith: NodeJS.Signals[] = [];

  onceExit(listener: typeof this.exitListener) {
    this.exitListener = listener;
  }

  onceError(listener: typeof this.errorListener) {
    this.errorListener = listener;
  }

  kill(signal: NodeJS.Signals) {
    this.killedWith.push(signal);
  }

  exit(code: number | null, signal: NodeJS.Signals | null) {
    this.exitListener?.(code, signal);
  }
}
