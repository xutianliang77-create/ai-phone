import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { LuaFactory } from "wasmoon";
import { describe, expect, it } from "vitest";

const firmwareUrl = new URL(
  "../../../../firmware/air780-livekit-bridge/",
  import.meta.url,
);

const productionSources = [
  ["production/main.lua", "main.lua"],
  ["vuart_v1_codec.lua", "vuart_v1_codec.lua"],
  ["vuart_v1_cmd_codec.lua", "vuart_v1_cmd_codec.lua"],
  ["vuart_v1_stream.lua", "vuart_v1_stream.lua"],
  ["vuart_v1_ledger.lua", "vuart_v1_ledger.lua"],
  ["vuart_v1_runtime.lua", "vuart_v1_runtime.lua"],
  ["vuart_v1_uart.lua", "vuart_v1_uart.lua"],
  ["vuart_v1_uplink.lua", "vuart_v1_uplink.lua"],
  ["vuart_v1_cc.lua", "vuart_v1_cc.lua"],
] as const;

const behaviorFiles = [
  ...productionSources.slice(1).map(([source]) => source),
  "vuart_v1_io_test.lua",
] as const;

describe("Air780 LuatOS production entry", () => {
  it("pins a flat Luatools bundle with no test files", () => {
    const manifest = readFileSync(
      new URL("PROD_FLASH_MANIFEST.tsv", firmwareUrl),
      "utf8",
    );
    const entries = manifest.trim().split("\n").map((line) => {
      const match = line.match(
        /^([0-9a-f]{64})\t([A-Za-z0-9_./-]+)\t([A-Za-z0-9_.-]+)$/,
      );
      expect(match).not.toBeNull();
      return { hash: match![1], source: match![2], target: match![3] };
    });
    expect(entries.map(({ source, target }) => [source, target]))
      .toEqual(productionSources);
    expect(new Set(entries.map(({ target }) => target)).size).toBe(entries.length);
    for (const { hash, source, target } of entries) {
      expect(Buffer.byteLength(target, "utf8"), target).toBeLessThanOrEqual(24);
      const bytes = readFileSync(new URL(source, firmwareUrl));
      expect(createHash("sha256").update(bytes).digest("hex"), source).toBe(hash);
      expect(source).not.toMatch(/(?:test|mock)/);
    }
  });

  it("keeps diagnostic text and private payloads out of production", () => {
    for (const [source] of productionSources) {
      const body = readFileSync(new URL(source, firmwareUrl), "utf8");
      expect(body, source).not.toContain("WJAI/1");
      expect(body, source).not.toMatch(/json\.(?:encode|decode)/);
      expect(body, source).not.toContain("WJG0B/1");
      expect(body, source).not.toContain("sendDtmf");
    }
  });

  it("executes bounded UART and cc adapter behavior in Lua", async () => {
    const factory = new LuaFactory();
    for (const file of behaviorFiles) {
      await factory.mountFile(
        `/firmware/${file}`,
        readFileSync(new URL(file, firmwareUrl)),
      );
    }
    const lua = await factory.createEngine();
    try {
      const result = await lua.doString(`
        package.path = "/firmware/?.lua;" .. package.path
        local result = require("vuart_v1_io_test").run()
        if type(result) ~= "table" or result.ok ~= true then
          error("production IO suite returned no PASS result")
        end
        return result.status
      `);
      expect(result).toBe("PRODUCTION_IO_HOST_PASS");
    } finally {
      lua.global.close();
    }
  });

  it("boots the real production main with LuatOS API-compatible mocks", async () => {
    const factory = new LuaFactory();
    for (const [source] of productionSources) {
      await factory.mountFile(
        `/firmware/${source}`,
        readFileSync(new URL(source, firmwareUrl)),
      );
    }
    const lua = await factory.createEngine();
    try {
      const result = await lua.doString(`
        package.path = "/firmware/?.lua;" .. package.path
        local subscriptions, writes, loop_timers, receive_callback = {}, {}, {}, nil
        local uart_read_value = ""
        local init_calls, record_calls, audio_setup_calls, dial_calls = 0, 0, 0, 0
        local source_starts, source_stops, input_bytes = 0, 0, 0
        local buffers = {}
        local function host_object(values, kind)
          local object = kind == "thread" and coroutine.create(function() end)
            or kind == "function" and function() end
            or io.stdout
          debug.setmetatable(object, { __index = values })
          return object
        end
        local function zbuffer()
          local value = { value = "" }
          function value:used() return #self.value end
          function value:query() return self.value end
          function value:del() self.value = "" end
          buffers[#buffers + 1] = value
          return value
        end

        uart = host_object({
          VUART_0 = 9,
          setup = function(id, baud, bits, stop)
            assert(id == 9 and baud == 115200 and bits == 8 and stop == 1)
            return 0
          end,
          on = function(id, event, callback)
            assert(id == 9 and event == "receive")
            receive_callback = callback
          end,
          write = function(id, value)
            assert(id == 9)
            writes[#writes + 1] = value
            return #value
          end,
          read = function()
            local value = uart_read_value
            uart_read_value = ""
            return value
          end,
          close = function() end,
        }, "thread")
        cc = host_object({
          init = function(sim_id) assert(sim_id == 0); init_calls = init_calls + 1; return true end,
          on = function(event, callback) assert(event == "record"); _G.record_callback = callback end,
          record = function(enabled, up1, up2, down1, down2)
            assert(enabled and up1 and up2 and down1 and down2)
            record_calls = record_calls + 1
            return true
          end,
          dial = function() dial_calls = dial_calls + 1; return true end,
          hangUp = function() end,
          quality = function() return 2 end,
          extern_source = function(enabled, is_play, codec, loop, rate, bits, channels, signed)
            if enabled == nil then source_stops = source_stops + 1; return true end
            assert(enabled and is_play and codec == 0 and loop)
            assert(rate == 16000 and bits == 16 and channels == 1 and signed)
            source_starts = source_starts + 1
            return true
          end,
          input = function(is_play, value, is_end)
            assert(is_play and is_end == false and type(value) == "string")
            input_bytes = input_bytes + #value
            return true, #value, 6400
          end,
        }, "function")
        zbuff = host_object({ HEAP_AUTO = 0, create = function(size)
          assert(size == 6400)
          return zbuffer()
        end }, "userdata")
        sys = {
          subscribe = function(topic, callback) subscriptions[topic] = callback end,
          timerStart = function() end,
          timerLoopStart = function(callback, interval) loop_timers[interval] = callback end,
          taskInit = function(callback) callback() end,
          run = function() _G.sys_run_called = true end,
        }
        log = { info = function() end, warn = function() end, error = function() end }
        gpio = { AUDIOPA_EN = 18 }
        mcu = {
          unique_id = function() return string.char(1, 2, 3, 4) end,
          ticks2 = function() return 0, 25 end,
        }
        crypto = {
          trng = function(length) assert(length == 16); return string.rep("\\170", length) end,
          crc32 = function(value)
            local crc = 0xffffffff
            for index = 1, #value do
              crc = crc ~ value:byte(index)
              for _ = 1, 8 do
                local mask = -(crc & 1)
                crc = (crc >> 1) ~ (0xedb88320 & mask)
              end
            end
            return (~crc) & 0xffffffff
          end,
          sha256 = function(value) return value end,
        }
        rtos = { version = function() return "V2048" end }
        package.preload.air153C_wtd = function()
          return { init = function() end, feed_dog = function() end }
        end
        package.preload.exaudio = function()
          return {
            setup = function(config)
              assert(config.model == "es8311" and config.audio_mode == "new")
              audio_setup_calls = audio_setup_calls + 1
              return true
            end,
            get_audio_mode = function() return "audio_v2" end,
          }
        end

        dofile("/firmware/production/main.lua")
        assert(sys_run_called == true and receive_callback ~= nil)
        assert(audio_setup_calls == 1 and init_calls == 0 and #writes == 0)
        subscriptions.CC_IND("READY")
        assert(init_calls == 1 and record_calls == 1 and #buffers == 4)
        assert(#writes == 2)
        local frame = assert(require("vuart_v1_codec").decode_frame(writes[1]))
        local hello = assert(require("vuart_v1_cmd_codec").decode_hello(frame.payload))
        assert(frame.type == 1 and hello.capability_flags == 7)
        assert(hello.device_id == "air780-01020304")
        assert(hello.boot_id == string.rep("aa", 16))
        assert(type(loop_timers[5000]) == "function")
        loop_timers[5000]()
        assert(#writes == 4)
        local periodic_hello = assert(require("vuart_v1_codec").decode_frame(writes[3]))
        local periodic_heartbeat = assert(require("vuart_v1_codec").decode_frame(writes[4]))
        assert(periodic_hello.type == 1 and periodic_heartbeat.type == 2)
        local repeated = assert(require("vuart_v1_cmd_codec").decode_hello(
          periodic_hello.payload))
        assert(repeated.boot_id == hello.boot_id and repeated.capability_flags == 7)

        local frame_codec = require("vuart_v1_codec")
        local command_codec = require("vuart_v1_cmd_codec")
        local command = {
          communication_session_id = "comm-main-1",
          provider_call_id = "call-main-1",
          device_id = hello.device_id,
          lease_id = "lease-main-1",
          fencing_token = 1,
          call_generation = 1,
          provider_operation_id = "operation-main-1",
          command_id = "command-main-1",
          idempotency_key = "air-command:comm-main-1:1:1",
          type = "dial",
          dial_target_e164 = "+8613800138000",
        }
        uart_read_value = assert(frame_codec.encode_frame({
          type = 3,
          flags = 0,
          sequence = 1,
          timestamp_ms = "1",
          payload = assert(command_codec.encode_command(command)),
        }))
        receive_callback(9, #uart_read_value)
        assert(dial_calls == 1)
        assert(frame_codec.decode_frame(writes[#writes]).type == 32)
        subscriptions.CC_IND("MAKE_CALL_OK")
        subscriptions.CC_IND("CONNECTED")
        subscriptions.CC_IND("AUDIO_START")
        buffers[3].value = string.rep("d", 6400)
        record_callback(true, 0)
        local audio_frame = assert(frame_codec.decode_frame(writes[#writes]))
        local audio = assert(frame_codec.decode_audio(audio_frame.payload))
        assert(audio_frame.type == 16 and audio.pcm == string.rep("d", 6400))
        local write_count = #writes
        buffers[1].value = string.rep("u", 6400)
        record_callback(false, 0)
        assert(#writes == write_count)
        local uplink = {
          communication_session_id = command.communication_session_id,
          provider_call_id = command.provider_call_id,
          device_id = command.device_id,
          lease_id = command.lease_id,
          fencing_token = command.fencing_token,
          call_generation = command.call_generation,
          media_sequence = 0,
          pcm = string.rep("t", 6400),
        }
        uart_read_value = assert(frame_codec.encode_frame({
          type = 17, flags = 0, sequence = 2, timestamp_ms = "2",
          payload = assert(frame_codec.encode_audio(uplink)),
        }))
        receive_callback(9, #uart_read_value)
        assert(source_starts == 1 and source_stops == 0 and input_bytes == 6400)
        return PROJECT .. ":" .. VERSION
      `);
      expect(result).toBe("WUJIE_AIR_VUART_V1_PROD:001.002.001");
    } finally {
      lua.global.close();
    }
  });
});
