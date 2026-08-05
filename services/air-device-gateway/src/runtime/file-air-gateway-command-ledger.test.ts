import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileAirGatewayCommandLedger } from
  "./file-air-gateway-command-ledger.js";

describe("Air Gateway durable command ledger", () => {
  let directory = "";
  let path = "";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "air-gateway-ledger-"));
    path = join(directory, "commands.json");
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("atomically persists and reloads retained command outcomes", async () => {
    const ledger = new FileAirGatewayCommandLedger(path);
    expect(await ledger.load()).toEqual([]);

    await ledger.upsert(record);
    expect(await new FileAirGatewayCommandLedger(path).load()).toEqual([record]);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).not.toContain("+8613800138000");

    await ledger.remove(record.commandId);
    expect(await new FileAirGatewayCommandLedger(path).load()).toEqual([]);
  });

  it("fails closed on a malformed or unsupported ledger", async () => {
    await writeFile(path, '{"version":1,"records":[', { mode: 0o600 });
    await expect(new FileAirGatewayCommandLedger(path).load())
      .rejects.toThrow("invalid");

    await writeFile(path, JSON.stringify({ version: 2, records: [] }));
    await expect(new FileAirGatewayCommandLedger(path).load())
      .rejects.toThrow("unsupported");
  });
});

const record = {
  commandId: "command-1",
  signature: "a".repeat(64),
  idempotencyKey: "dial:comm-1:1",
  result: {
    status: "timeout_reconcile_required" as const,
    commandId: "command-1",
    attempts: 0,
    replayed: false,
  },
};
