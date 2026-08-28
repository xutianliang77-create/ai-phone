import { readFileSync } from "node:fs";
import { LuaFactory } from "wasmoon";
import { describe, expect, it } from "vitest";

const firmwareUrl = new URL(
  "../../../../firmware/air780-livekit-bridge/",
  import.meta.url,
);
const productionSources = [
  "production/main.lua",
  "vuart_v1_codec.lua",
  "vuart_v1_cmd_codec.lua",
  "vuart_v1_stream.lua",
  "vuart_v1_ledger.lua",
  "vuart_v1_runtime.lua",
  "vuart_v1_uart.lua",
  "vuart_v1_uplink.lua",
  "vuart_v1_cc.lua",
  "vuart_v1_memory.lua",
] as const;

describe("Air780 LuatOS production core guard", () => {
  it("fails closed before opening VUART without the V2048 stream API", async () => {
    const factory = new LuaFactory();
    for (const source of productionSources) {
      await factory.mountFile(
        `/firmware/${source}`,
        readFileSync(new URL(source, firmwareUrl)),
      );
    }
    const lua = await factory.createEngine();
    try {
      const result = await lua.doString(`
        package.path = "/firmware/?.lua;" .. package.path
        local uart_setup_calls, cc_init_calls, audio_setup_calls = 0, 0, 0
        local errors = {}
        uart = {
          VUART_0 = 9,
          setup = function() uart_setup_calls = uart_setup_calls + 1; return 0 end,
          on = function() end,
          read = function() return "" end,
          write = function() return 0 end,
          close = function() end,
        }
        cc = {
          init = function() cc_init_calls = cc_init_calls + 1; return true end,
          on = function() end,
          record = function() return true end,
          dial = function() return true end,
          hangUp = function() return true end,
          quality = function() return 2 end,
          extern_source = function() return true end,
        }
        zbuff = { HEAP_AUTO = 0, create = function() return {} end }
        sys = {
          timerLoopStart = function() end,
          timerStart = function() end,
          taskInit = function(callback) callback() end,
          run = function() _G.sys_run_called = true end,
        }
        log = {
          info = function() end,
          error = function(_, reason) errors[#errors + 1] = tostring(reason) end,
        }
        gpio = { AUDIOPA_EN = 18 }
        mcu = {
          unique_id = function() return string.char(1, 2, 3, 4) end,
          ticks2 = function() return 0, 25 end,
        }
        crypto = { trng = function() return string.rep("a", 16) end }
        rtos = { version = function() return "V2046" end }
        package.preload.air153C_wtd = function()
          return { init = function() end, feed_dog = function() end }
        end
        package.preload.exaudio = function()
          return {
            setup = function() audio_setup_calls = audio_setup_calls + 1; return true end,
            get_audio_mode = function() return "audio_v2" end,
          }
        end

        dofile("/firmware/production/main.lua")
        assert(sys_run_called == true)
        assert(uart_setup_calls == 0 and cc_init_calls == 0 and audio_setup_calls == 0)
        assert(#errors == 1 and errors[1] == "requires_v2048")
        return "PRODUCTION_CORE_GUARD_PASS"
      `);
      expect(result).toBe("PRODUCTION_CORE_GUARD_PASS");
    } finally {
      lua.global.close();
    }
  });
});
