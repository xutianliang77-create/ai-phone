import { readFileSync } from "node:fs";
import { LuaFactory } from "wasmoon";
import { describe, expect, it } from "vitest";

const source = new URL(
  "../../../../firmware/air780-livekit-bridge/vuart_v1_uplink.lua",
  import.meta.url,
);

describe("Air780 production Lua TTS uplink", () => {
  it("handles 8k conversion, partial writes, backpressure, and stale generations", async () => {
    const factory = new LuaFactory();
    await factory.mountFile("/firmware/vuart_v1_uplink.lua", readFileSync(source));
    const lua = await factory.createEngine();
    try {
      const status = await lua.doString(`
        package.path = "/firmware/?.lua;" .. package.path
        local module = require("vuart_v1_uplink")
        local scheduled, inputs, source_calls = {}, {}, {}
        local limits = {1000, 0, 2200}
        local cc = {
          extern_source = function(...)
            source_calls[#source_calls + 1] = {...}
            return true
          end,
          input = function(_, value, is_end)
            assert(is_end == false)
            local accepted = math.min(table.remove(limits, 1) or #value, #value)
            inputs[#inputs + 1] = value:sub(1, accepted)
            return true, accepted, accepted == 0 and 0 or 6400
          end,
        }
        local uplink = module.new({
          cc_api = cc,
          raw_codec = 0,
          capacity_chunks = 1,
          schedule = function(callback) scheduled[#scheduled + 1] = callback end,
        })
        assert(uplink:begin_call(3, 1) == true)
        local pair = string.char(0, 16, 0, 240)
        assert(uplink:enqueue(3, 0, string.rep(pair, 1600)) == true)
        assert(#source_calls == 1)
        local args = source_calls[1]
        assert(args[1] == true and args[2] == true and args[3] == 0)
        assert(args[4] == true and args[5] == 8000 and args[6] == 16)
        assert(args[7] == 1 and args[8] == true)
        assert(#scheduled == 1)
        table.remove(scheduled, 1)()
        assert(#scheduled == 1)
        table.remove(scheduled, 1)()
        local output = table.concat(inputs)
        assert(#output == 3200 and output == string.rep(string.char(0, 0), 1600))
        assert(uplink:enqueue(3, 0, string.rep(pair, 1600)) == false)
        assert(uplink:stop(3) == true)
        assert(source_calls[#source_calls][1] == nil)
        assert(uplink:begin_call(3, 1) == false)
        assert(uplink:begin_call(4, 2) == true)

        limits = {0}
        local pcm16 = string.rep(string.char(1, 2), 3200)
        assert(uplink:enqueue(4, 0, pcm16) == true)
        local accepted, reason = uplink:enqueue(4, 1, pcm16)
        assert(accepted == false and reason == "backpressure")
        local metrics = uplink:metrics()
        assert(metrics.sample_rate == 16000)
        assert(metrics.duplicate_chunks == 1)
        assert(metrics.stale_generation_rejections == 1)
        assert(metrics.backpressure_events == 3)
        assert(metrics.zero_writes == 2)
        assert(metrics.dropped_chunks == 1)
        assert(metrics.queue_depth == 1)
        return "LUA_TTS_UPLINK_PASS"
      `);
      expect(status).toBe("LUA_TTS_UPLINK_PASS");
    } finally {
      lua.global.close();
    }
  });
});
