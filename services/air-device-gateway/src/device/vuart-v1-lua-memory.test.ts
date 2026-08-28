import { readFileSync } from "node:fs";
import { LuaFactory } from "wasmoon";
import { describe, expect, it } from "vitest";

const memorySource = new URL(
  "../../../../firmware/air780-livekit-bridge/vuart_v1_memory.lua",
  import.meta.url,
);

describe("Air780 LuatOS memory monitor", () => {
  it("tracks Lua/sys watermarks and fails closed once on low memory", async () => {
    const factory = new LuaFactory();
    await factory.mountFile(
      "/firmware/vuart_v1_memory.lua",
      readFileSync(memorySource),
    );
    const lua = await factory.createEngine();
    try {
      const result = await lua.doString(`
        package.path = "/firmware/?.lua;" .. package.path
        local samples = {
          lua = {
            { 1048576, 262144, 300000 },
            { 1048576, 950000, 960000 },
          },
          sys = {
            { 2097152, 524288, 600000 },
            { 2097152, 600000, 700000 },
          },
        }
        local positions = { lua = 0, sys = 0 }
        local faults = {}
        local monitor = require("vuart_v1_memory").new({
          rtos_api = {
            meminfo = function(kind)
              positions[kind] = positions[kind] + 1
              return table.unpack(samples[kind][positions[kind]])
            end,
          },
          minimum_lua_free_bytes = 131072,
          minimum_sys_free_bytes = 131072,
          on_fault = function(reason) faults[#faults + 1] = reason end,
        })
        local first_ok, first = monitor:sample()
        assert(first_ok == true and first.lua_free == 786432)
        assert(first.sys_free == 1572864)
        local second_ok, second = monitor:sample()
        assert(second_ok == false and second.lua_free == 98576)
        assert(#faults == 1 and faults[1] == "low_memory")
        local metrics = monitor:metrics()
        assert(metrics.samples == 2 and metrics.low_memory_events == 1)
        assert(metrics.minimum_lua_free_bytes == 98576)
        assert(metrics.minimum_sys_free_bytes == 1497152)
        assert(metrics.maximum_lua_peak_bytes == 960000)
        assert(metrics.maximum_sys_peak_bytes == 700000)
        assert(metrics.faulted == true)
        return "MEMORY_MONITOR_PASS"
      `);
      expect(result).toBe("MEMORY_MONITOR_PASS");
    } finally {
      lua.global.close();
    }
  });

  it("fails closed when rtos.meminfo returns an invalid contract", async () => {
    const factory = new LuaFactory();
    await factory.mountFile(
      "/firmware/vuart_v1_memory.lua",
      readFileSync(memorySource),
    );
    const lua = await factory.createEngine();
    try {
      const result = await lua.doString(`
        package.path = "/firmware/?.lua;" .. package.path
        local faults = 0
        local monitor = require("vuart_v1_memory").new({
          rtos_api = { meminfo = function() return 100, 101, 101 end },
          on_fault = function(reason)
            assert(reason == "meminfo_invalid")
            faults = faults + 1
          end,
        })
        local ok, snapshot = monitor:sample()
        assert(ok == false and snapshot == nil and faults == 1)
        assert(monitor:metrics().sample_failures == 1)
        return "MEMORY_INVALID_FAIL_CLOSED_PASS"
      `);
      expect(result).toBe("MEMORY_INVALID_FAIL_CLOSED_PASS");
    } finally {
      lua.global.close();
    }
  });
});
