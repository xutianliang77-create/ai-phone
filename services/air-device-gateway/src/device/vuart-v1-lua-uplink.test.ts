import { readFileSync } from "node:fs";
import { LuaFactory } from "wasmoon";
import { describe, expect, it } from "vitest";

const source = new URL(
  "../../../../firmware/air780-livekit-bridge/vuart_v1_uplink.lua",
  import.meta.url,
);

describe("Air780 production Lua TTS uplink", () => {
  it("holds carrier uplink silent before and between translated or AI audio", async () => {
    const factory = new LuaFactory();
    await factory.mountFile("/firmware/vuart_v1_uplink.lua", readFileSync(source));
    const lua = await factory.createEngine();
    try {
      const status = await lua.doString(`
        package.path = "/firmware/?.lua;" .. package.path
        local module = require("vuart_v1_uplink")
        local clock = 100
        local scheduled, inputs, source_calls = {}, {}, {}
        local cc = {
          extern_source = function(...)
            source_calls[#source_calls + 1] = {...}
            return true
          end,
          input = function(_, value, is_end)
            assert(is_end == false)
            inputs[#inputs + 1] = value
            return true, #value, 6400
          end,
        }
        local uplink = module.new({
          cc_api = cc,
          now_ms = function() return clock end,
          raw_codec = 0,
          schedule = function(callback, delay)
            scheduled[#scheduled + 1] = { callback = callback, delay = delay }
          end,
        })
        local silence = string.rep("\\0", 6400)
        assert(uplink:begin_call(7, 2) == true)
        assert(#source_calls == 1 and #inputs == 1 and inputs[1] == silence)
        assert(#scheduled == 1 and scheduled[1].delay == 200)
        local initial = uplink:metrics()
        assert(initial.source_active == true and initial.silence_chunks == 1)
        assert(initial.source_started_ms == 100 and initial.last_input_ms == 100)
        assert(initial.chunks_written == 0)

        local translated = string.rep(string.char(1, 2), 3200)
        clock = 200
        assert(uplink:enqueue(7, 0, translated) == true)
        assert(inputs[2] == translated)
        local scheduled_before_refill = #scheduled
        local input_count = #inputs
        for index = 1, scheduled_before_refill do
          scheduled[index].callback()
        end
        assert(#inputs == input_count + 1 and inputs[#inputs] == silence)
        local active = uplink:metrics()
        assert(active.silence_chunks == 2)
        assert(active.chunks_written == 1)
        assert(active.bytes_written == 6400)
        assert(active.last_input_ms == 200)

        assert(uplink:stop(7) == true)
        local stopped_at = #inputs
        for index = 1, #scheduled do scheduled[index].callback() end
        assert(#inputs == stopped_at)
        assert(uplink:enqueue(7, 1, translated) == false)
        return "LUA_FAIL_CLOSED_SILENCE_PASS"
      `);
      expect(status).toBe("LUA_FAIL_CLOSED_SILENCE_PASS");
    } finally {
      lua.global.close();
    }
  });

  it("handles 8k conversion, partial writes, backpressure, and stale generations", async () => {
    const factory = new LuaFactory();
    await factory.mountFile("/firmware/vuart_v1_uplink.lua", readFileSync(source));
    const lua = await factory.createEngine();
    try {
      const status = await lua.doString(`
        package.path = "/firmware/?.lua;" .. package.path
        local module = require("vuart_v1_uplink")
        local scheduled, inputs, source_calls = {}, {}, {}
        local results = {{ written = 3200, free = 3200 }}
        local cc = {
          extern_source = function(...)
            source_calls[#source_calls + 1] = {...}
            return true
          end,
          input = function(_, value, is_end)
            assert(is_end == false)
            local result = table.remove(results, 1)
              or { written = #value, free = #value }
            local accepted = math.min(result.written, #value)
            inputs[#inputs + 1] = value:sub(1, accepted)
            return true, accepted, result.free
          end,
        }
        local uplink = module.new({
          cc_api = cc,
          raw_codec = 0,
          capacity_chunks = 1,
          schedule = function(callback, delay)
            scheduled[#scheduled + 1] = { callback = callback, delay = delay }
          end,
        })
        assert(uplink:begin_call(3, 1) == true)
        assert(table.concat(inputs) == string.rep("\\0", 3200))
        assert(scheduled[1].delay == 200)
        scheduled, inputs, results = {}, {}, {
          { written = 1000, free = 0 },
          { written = 0, free = 1600 },
          { written = 2200, free = 0 },
        }
        local pair = string.char(0, 16, 0, 240)
        assert(uplink:enqueue(3, 0, string.rep(pair, 1600)) == true)
        assert(#source_calls == 1)
        local args = source_calls[1]
        assert(args[1] == true and args[2] == true and args[3] == 0)
        assert(args[4] == true and args[5] == 8000 and args[6] == 16)
        assert(args[7] == 1 and args[8] == true)
        assert(#scheduled == 1 and scheduled[1].delay == 138)
        table.remove(scheduled, 1).callback()
        assert(#scheduled == 1 and scheduled[1].delay == 38)
        table.remove(scheduled, 1).callback()
        assert(#scheduled == 1 and scheduled[1].delay == 200)
        local output = table.concat(inputs)
        assert(#output == 3200 and output == string.rep(string.char(0, 0), 1600))
        assert(uplink:enqueue(3, 0, string.rep(pair, 1600)) == false)
        assert(uplink:stop(3) == true)
        assert(source_calls[#source_calls][1] == nil)
        assert(uplink:begin_call(3, 1) == false)
        assert(uplink:begin_call(4, 2) == true)

        scheduled, inputs, results = {}, {}, {{ written = 0, free = 0 }}
        local pcm16 = string.rep(string.char(1, 2), 3200)
        assert(uplink:enqueue(4, 0, pcm16) == true)
        local accepted, reason = uplink:enqueue(4, 1, pcm16)
        assert(accepted == false and reason == "backpressure")
        local metrics = uplink:metrics()
        assert(metrics.sample_rate == 16000)
        assert(metrics.duplicate_chunks == 1)
        assert(metrics.stale_generation_rejections == 1)
        assert(metrics.backpressure_events == 2)
        assert(metrics.zero_writes == 2)
        assert(metrics.dropped_chunks == 1)
        assert(metrics.queue_depth == 1)
        assert(metrics.last_free_len == 0 and metrics.scheduled_delay_ms == 200)
        return "LUA_TTS_UPLINK_PASS"
      `);
      expect(status).toBe("LUA_TTS_UPLINK_PASS");
    } finally {
      lua.global.close();
    }
  });
});
