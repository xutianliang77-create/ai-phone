import { readFileSync } from "node:fs";
import { LuaFactory } from "wasmoon";
import { describe, expect, it } from "vitest";

const source = new URL(
  "../../../../firmware/air780-livekit-bridge/vuart_v1_mic_guard.lua",
  import.meta.url,
);
const readme = new URL(
  "../../../../firmware/air780-livekit-bridge/README.md",
  import.meta.url,
);

describe("Air780 production Lua microphone guard", () => {
  it("keeps the deployed media failure boundary in the firmware status", () => {
    const status = readFileSync(readme, "utf8")
      .split("\n").find((line) => line.startsWith("状态："));
    expect(status).toBe(
      "状态：`Gate 0A PASS / PROD_001.007.000_DEPLOYED / " +
      "CONTROL_PATH_PARTIAL / AIR_DOWNLINK_PCM_FAIL / " +
      "TX_REPLACE_BLOCKED_VENDOR_CORE_API / GATE0B_BLOCKED_UNVERIFIED / " +
      "PRODUCT_NOT_END_TO_END_READY`",
    );
  });

  it("proves the ES8311 control path before muting the ADC output", async () => {
    const factory = new LuaFactory();
    await factory.mountFile("/firmware/vuart_v1_mic_guard.lua", readFileSync(source));
    const lua = await factory.createEngine();
    try {
      const status = await lua.doString(`
        package.path = "/firmware/?.lua;" .. package.path
        local guard = require("vuart_v1_mic_guard")
        local volume, writes = 80, {}
        local ok, evidence = guard.mute({
          i2c_id = 0,
          set_volume = function(value)
            writes[#writes + 1] = value
            volume = value
            return true
          end,
          get_volume = function(i2c_id)
            assert(i2c_id == 0)
            return volume
          end,
        })
        assert(ok == true and evidence.probe_readback == 10)
        assert(evidence.muted_readback == 0)
        assert(#writes == 2 and writes[1] == 10 and writes[2] == 0)
        return "MIC_GUARD_MUTE_PASS"
      `);
      expect(status).toBe("MIC_GUARD_MUTE_PASS");
    } finally {
      lua.global.close();
    }
  });

  it("fails closed on a missing API, write failure, or invalid readback", async () => {
    const factory = new LuaFactory();
    await factory.mountFile("/firmware/vuart_v1_mic_guard.lua", readFileSync(source));
    const lua = await factory.createEngine();
    try {
      const status = await lua.doString(`
        package.path = "/firmware/?.lua;" .. package.path
        local guard = require("vuart_v1_mic_guard")
        local ok, reason = guard.mute({ i2c_id = 0 })
        assert(ok == false and reason == "api_unavailable")

        ok, reason = guard.mute({
          i2c_id = 0,
          set_volume = function() return false end,
          get_volume = function() return 10 end,
        })
        assert(ok == false and reason == "probe_write_failed")

        ok, reason = guard.mute({
          i2c_id = 0,
          set_volume = function() return true end,
          get_volume = function() return 0 end,
        })
        assert(ok == false and reason == "probe_readback_failed")

        local calls = 0
        ok, reason = guard.mute({
          i2c_id = 0,
          set_volume = function()
            calls = calls + 1
            return calls == 1
          end,
          get_volume = function() return 10 end,
        })
        assert(ok == false and reason == "mute_write_failed")

        local volume = 10
        ok, reason = guard.mute({
          i2c_id = 0,
          set_volume = function(value)
            if value == 10 then volume = 10 end
            return true
          end,
          get_volume = function() return volume end,
        })
        assert(ok == false and reason == "mute_readback_failed")
        return "MIC_GUARD_FAIL_CLOSED_PASS"
      `);
      expect(status).toBe("MIC_GUARD_FAIL_CLOSED_PASS");
    } finally {
      lua.global.close();
    }
  });
});
