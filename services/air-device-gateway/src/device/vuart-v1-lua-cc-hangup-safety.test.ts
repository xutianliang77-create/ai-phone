import { readFileSync } from "node:fs";
import { LuaFactory } from "wasmoon";
import { describe, expect, it } from "vitest";

const ccSource = new URL(
  "../../../../firmware/air780-livekit-bridge/vuart_v1_cc.lua",
  import.meta.url,
);
const uplinkSource = new URL(
  "../../../../firmware/air780-livekit-bridge/vuart_v1_uplink.lua",
  import.meta.url,
);

describe("Air780 production Lua hangup safety", () => {
  it("reports unknown and blocks repeat hangups when source failure cannot request hangup", async () => {
    const factory = new LuaFactory();
    await factory.mountFile("/firmware/vuart_v1_cc.lua", readFileSync(ccSource));
    await factory.mountFile(
      "/firmware/vuart_v1_uplink.lua",
      readFileSync(uplinkSource),
    );
    const lua = await factory.createEngine();
    try {
      const status = await lua.doString(`
        package.path = "/firmware/?.lua;" .. package.path
        local cc_module = require("vuart_v1_cc")
        local uplink_module = require("vuart_v1_uplink")
        local subscriptions, hangup_calls, events = {}, 0, {}
        local cc = {
          init = function() return true end,
          dial = function() return true end,
          hangUp = function() hangup_calls = hangup_calls + 1; return false end,
          quality = function() return 2 end,
          extern_source = function() return false end,
          input = function() error("input must not run") end,
        }
        local uplink = uplink_module.new({
          cc_api = cc,
          raw_codec = 0,
          schedule = function() end,
        })
        local carrier = cc_module.new({
          cc_api = cc,
          subscribe = function(topic, callback) subscriptions[topic] = callback end,
          enable_downlink = false,
          uplink = uplink,
          on_event = function(carrier_state, carrier_cause)
            events[#events + 1] = { state = carrier_state, cause = carrier_cause }
          end,
        })
        subscriptions.CC_IND("READY")
        carrier:set_audio_ready(true)
        assert(carrier.dial({
          dial_target_e164 = "+8613800138000", call_generation = 13,
        }).status == "applied")
        subscriptions.CC_IND("CONNECTED")
        subscriptions.CC_IND("AUDIO_START")
        assert(carrier.audio_uplink(string.rep("\\1\\2", 3200), 0, 13) == false)
        subscriptions.CC_IND("EXT_SRC_DONE")
        assert(hangup_calls == 1)
        local metrics = carrier:metrics()
        assert(metrics.source_failure_hangups == 0)
        assert(metrics.source_failure_hangup_failures == 1)
        assert(metrics.source_failure_unknown_events == 1)
        local unknown = events[#events]
        assert(unknown.state == "unknown" and unknown.cause == "unknown")
        subscriptions.CC_IND("DISCONNECTED")
        local terminal = events[#events]
        assert(terminal.state == "failed" and terminal.cause == "device_error")
        return "LUA_HANGUP_REJECTION_QUARANTINE_PASS"
      `);
      expect(status).toBe("LUA_HANGUP_REJECTION_QUARANTINE_PASS");
    } finally {
      lua.global.close();
    }
  });

  it("rejects an explicit hangup when the carrier API reports false", async () => {
    const factory = new LuaFactory();
    await factory.mountFile("/firmware/vuart_v1_cc.lua", readFileSync(ccSource));
    const lua = await factory.createEngine();
    try {
      const status = await lua.doString(`
        package.path = "/firmware/?.lua;" .. package.path
        local cc_module = require("vuart_v1_cc")
        local subscriptions, hangup_calls = {}, 0
        local cc = {
          init = function() return true end,
          dial = function() return true end,
          hangUp = function() hangup_calls = hangup_calls + 1; return false end,
          quality = function() return 2 end,
        }
        local carrier = cc_module.new({
          cc_api = cc,
          subscribe = function(topic, callback) subscriptions[topic] = callback end,
          enable_downlink = false,
        })
        subscriptions.CC_IND("READY")
        carrier:set_audio_ready(true)
        assert(carrier.dial({
          dial_target_e164 = "+8613800138000", call_generation = 1,
        }).status == "applied")
        subscriptions.CC_IND("CONNECTED")
        assert(carrier.hangup({}).status == "rejected")
        assert(carrier.hangup({}).error_code == "internal_error")
        assert(hangup_calls == 2)
        assert(carrier:metrics().hangup_calls == 0)
        return "LUA_HANGUP_REJECTION_PASS"
      `);
      expect(status).toBe("LUA_HANGUP_REJECTION_PASS");
    } finally {
      lua.global.close();
    }
  });
});
