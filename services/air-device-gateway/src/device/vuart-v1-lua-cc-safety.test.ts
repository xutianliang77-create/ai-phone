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

describe("Air780 production Lua external-source safety", () => {
  it("hangs up and permanently closes admission on memory pressure", async () => {
    const factory = new LuaFactory();
    await factory.mountFile("/firmware/vuart_v1_cc.lua", readFileSync(ccSource));
    const lua = await factory.createEngine();
    try {
      const status = await lua.doString(`
        package.path = "/firmware/?.lua;" .. package.path
        local subscriptions, hangup_calls, record_stops = {}, 0, 0
        local carrier = require("vuart_v1_cc").new({
          cc_api = {
            init = function() return true end,
            dial = function() return true end,
            hangUp = function() hangup_calls = hangup_calls + 1; return true end,
            quality = function() return 2 end,
            record = function(enabled)
              if not enabled then record_stops = record_stops + 1 end
              return true
            end,
          },
          subscribe = function(topic, callback) subscriptions[topic] = callback end,
          enable_downlink = false,
        })
        subscriptions.CC_IND("READY")
        carrier:set_audio_ready(true)
        assert(carrier.dial({ dial_target_e164 = "+8613800138000" }).status == "applied")
        subscriptions.CC_IND("CONNECTED")
        assert(carrier:fail_closed("low_memory") == true)
        assert(hangup_calls == 1)
        assert(carrier:fail_closed("low_memory") == true)
        assert(hangup_calls == 1)
        assert(carrier.dial({ dial_target_e164 = "+8613800138000" }).status == "rejected")
        local metrics = carrier:metrics()
        assert(metrics.ready == false and metrics.memory_failures == 1)
        assert(metrics.hangup_pending == true)
        return "LUA_MEMORY_PRESSURE_FAIL_CLOSED_PASS"
      `);
      expect(status).toBe("LUA_MEMORY_PRESSURE_FAIL_CLOSED_PASS");
    } finally {
      lua.global.close();
    }
  });

  it("quarantines AUDIO_START when record setup or quality validation fails", async () => {
    const factory = new LuaFactory();
    await factory.mountFile("/firmware/vuart_v1_cc.lua", readFileSync(ccSource));
    const lua = await factory.createEngine();
    try {
      const status = await lua.doString(`
        package.path = "/firmware/?.lua;" .. package.path
        local cc_module = require("vuart_v1_cc")

        local function run_case(quality, record_result)
          local subscriptions, events, hangup_calls = {}, {}, 0
          local cc = {
            init = function() return true end,
            on = function() end,
            record = function(on) if on then return record_result end return true end,
            dial = function() return true end,
            hangUp = function() hangup_calls = hangup_calls + 1; return false end,
            quality = function() return quality end,
          }
          local zbuff = {
            HEAP_AUTO = 0,
            create = function()
              return {
                used = function() return 0 end,
                seek = function() return true end,
                query = function() return "" end,
              }
            end,
          }
          local carrier = cc_module.new({
            cc_api = cc,
            subscribe = function(topic, callback) subscriptions[topic] = callback end,
            enable_downlink = true,
            zbuff_api = zbuff,
            on_event = function(state, cause)
              events[#events + 1] = state .. ":" .. cause
            end,
          })
          subscriptions.CC_IND("READY")
          carrier:set_audio_ready(true)
          assert(carrier.dial({ dial_target_e164 = "+8613800138000" }).status == "applied")
          subscriptions.CC_IND("CONNECTED")
          subscriptions.CC_IND("AUDIO_START")
          assert(hangup_calls == 1)
          assert(events[#events] == "unknown:unknown")
          local metrics = carrier:metrics()
          assert(metrics.record_active == false)
          assert(metrics.audio_quality == 0)
          assert(metrics.source_failure_hangups == 0)
          assert(metrics.source_failure_hangup_failures == 1)
          assert(carrier.audio_uplink(string.rep("\\1\\2", 3200), 0, 1) == false)
        end

        run_case(2, false)
        run_case(0, true)
        return "LUA_AUDIO_START_FAIL_CLOSED_PASS"
      `);
      expect(status).toBe("LUA_AUDIO_START_FAIL_CLOSED_PASS");
    } finally {
      lua.global.close();
    }
  });

  it("fails closed when an active TTS source completes before call termination", async () => {
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
          hangUp = function() hangup_calls = hangup_calls + 1 end,
          quality = function() return 2 end,
          extern_source = function() return true end,
          input = function(_, value, is_end)
            assert(is_end == false)
            return true, #value, 6400
          end,
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
        assert(carrier.dial({ dial_target_e164 = "+8613800138000" }).status == "applied")
        subscriptions.CC_IND("CONNECTED")
        subscriptions.CC_IND("AUDIO_START")
        assert(carrier.audio_uplink(string.rep("\\1\\2", 3200), 0, 7) == true)

        subscriptions.CC_IND("EXT_SRC_DONE")
        subscriptions.CC_IND("EXT_SRC_DONE")
        assert(hangup_calls == 1)
        assert(carrier.audio_uplink(string.rep("\\1\\2", 3200), 1, 7) == false)
        local metrics = carrier:metrics()
        assert(metrics.source_failure_hangups == 1)
        assert(metrics.source_failure_hangup_failures == 0)
        subscriptions.CC_IND("DISCONNECTED")
        local terminal = events[#events]
        assert(terminal.state == "failed" and terminal.cause == "device_error")
        return "LUA_EXTERNAL_SOURCE_FAIL_CLOSED_PASS"
      `);
      expect(status).toBe("LUA_EXTERNAL_SOURCE_FAIL_CLOSED_PASS");
    } finally {
      lua.global.close();
    }
  });

  it("fails closed if the first TTS frame cannot start its external source", async () => {
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
          hangUp = function() hangup_calls = hangup_calls + 1 end,
          quality = function() return 2 end,
          extern_source = function() return false end,
          input = function() error("input must not run after source start failure") end,
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
        assert(carrier.dial({ dial_target_e164 = "+8613800138000" }).status == "applied")
        subscriptions.CC_IND("CONNECTED")
        subscriptions.CC_IND("AUDIO_START")
        assert(carrier.audio_uplink(string.rep("\\1\\2", 3200), 0, 9) == false)
        assert(hangup_calls == 1)
        local metrics = carrier:metrics()
        assert(metrics.source_failure_hangups == 1)
        assert(metrics.source_failure_hangup_failures == 0)
        assert(metrics.uplink.faulted == true)
        subscriptions.CC_IND("DISCONNECTED")
        local terminal = events[#events]
        assert(terminal.state == "failed" and terminal.cause == "device_error")
        return "LUA_SOURCE_START_FAIL_CLOSED_PASS"
      `);
      expect(status).toBe("LUA_SOURCE_START_FAIL_CLOSED_PASS");
    } finally {
      lua.global.close();
    }
  });

  it("fails closed when the first TTS frame faults during cc.input", async () => {
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
          hangUp = function() hangup_calls = hangup_calls + 1 end,
          quality = function() return 2 end,
          extern_source = function() return true end,
          input = function() return false, 0, 0 end,
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
        assert(carrier.dial({ dial_target_e164 = "+8613800138000" }).status == "applied")
        subscriptions.CC_IND("CONNECTED")
        subscriptions.CC_IND("AUDIO_START")
        assert(carrier.audio_uplink(string.rep("\\1\\2", 3200), 0, 11) == false)
        assert(hangup_calls == 1)
        local metrics = carrier:metrics()
        assert(metrics.source_failure_hangups == 1)
        assert(metrics.uplink.faulted == true)
        assert(metrics.uplink.input_failures == 1)
        subscriptions.CC_IND("DISCONNECTED")
        local terminal = events[#events]
        assert(terminal.state == "failed" and terminal.cause == "device_error")
        return "LUA_INPUT_FAIL_CLOSED_PASS"
      `);
      expect(status).toBe("LUA_INPUT_FAIL_CLOSED_PASS");
    } finally {
      lua.global.close();
    }
  });

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
        assert(carrier.dial({ dial_target_e164 = "+8613800138000" }).status == "applied")
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
        assert(carrier.dial({ dial_target_e164 = "+8613800138000" }).status == "applied")
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
