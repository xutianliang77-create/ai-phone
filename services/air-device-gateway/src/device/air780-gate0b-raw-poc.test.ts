import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { LuaFactory } from "wasmoon";
import { describe, expect, it } from "vitest";

const firmwareUrl = new URL(
  "../../../../firmware/air780-livekit-bridge/",
  import.meta.url,
);

const pocSources = [
  ["gate0b/main.lua", "main.lua"],
  ["gate0b/g0b_raw.lua", "g0b_raw.lua"],
] as const;

const readFirmware = (path: string): Buffer =>
  readFileSync(new URL(path, firmwareUrl));

describe("Air780 Gate 0B V2048 RAW stream PoC", () => {
  it("pins a V2048-only string-input bundle and official CORE candidate", () => {
    const manifest = readFirmware("GATE0B_FLASH_MANIFEST.tsv")
      .toString("utf8");
    const entries = manifest.trim().split("\n").map((line) => {
      const match = line.match(
        /^([0-9a-f]{64})\t([A-Za-z0-9_./-]+)\t([A-Za-z0-9_.-]+)$/,
      );
      expect(match).not.toBeNull();
      return { hash: match![1], source: match![2], target: match![3] };
    });
    expect(entries.map(({ source, target }) => [source, target]))
      .toEqual(pocSources);
    for (const { hash, source, target } of entries) {
      expect(Buffer.byteLength(target, "utf8"), target).toBeLessThanOrEqual(24);
      const bytes = readFirmware(source);
      expect(createHash("sha256").update(bytes).digest("hex"), source).toBe(hash);
      const body = bytes.toString("utf8");
      expect(body, source).not.toContain("WJAI/1");
      expect(body, source).not.toMatch(/\bTTS\b|DATA_CODEC_TYPE_(MP3|WAV|AMR)/);
      expect(body, source).not.toMatch(/\bzbuff\b/);
    }

    const core = readFirmware("GATE0B_V2048_CORE_MANIFEST.tsv")
      .toString("utf8").trim().split("\t");
    expect(core).toEqual([
      "499a00aba41ead951e8b74cfde8c98ce05ddc621145e516d396268c7b7d5e9dd",
      "12491608",
      "LuatOS-SoC_V2048_Air780EHV_113.soc",
      "https://cdn18.luatos.com/files/Air780EHV/LuatOS_Air780EHV/" +
        "LuatOS-SoC_V2048_Air780EHV/" +
        "LuatOS-SoC_V2048_Air780EHV_113.soc",
    ]);

    const main = readFirmware("gate0b/main.lua").toString("utf8");
    expect(main).toContain("cc.input");
    expect(main).toContain("cc.dial");
    expect(main).toMatch(/core_version\s*<\s*2048/);
    expect(readFirmware("gate0b/g0b_raw.lua").toString("utf8"))
      .not.toContain("cc.dial");
  });

  it("streams losslessly with partial writes, backpressure, and one final DONE", async () => {
    const factory = new LuaFactory();
    await factory.mountFile(
      "/firmware/g0b_raw.lua",
      readFirmware("gate0b/g0b_raw.lua"),
    );
    const lua = await factory.createEngine();
    try {
      const result = await lua.doString(`
        package.path = "/firmware/?.lua;" .. package.path
        local free, starts, stops, end_calls, now = 4096, 0, 0, 0, 0
        local writes, sample_rates = {}, {}
        local cc_api = {
          extern_source = function(source, add, codec, error_stop,
            sample_rate, bits, channels, signed)
            if source == nil then stops = stops + 1; return true end
            assert(source == true and add == true and codec == 0)
            assert(error_stop == true and (sample_rate == 8000 or sample_rate == 16000))
            assert(bits == 16 and channels == 1 and signed == true)
            sample_rates[#sample_rates + 1] = sample_rate
            starts = starts + 1
            return true
          end,
          input = function(is_record, data, is_end)
            assert(is_record == true and type(data) == "string")
            if is_end then
              assert(data == "")
              end_calls = end_calls + 1
              return true, 0, free
            end
            local written = math.min(#data, free)
            if written > 0 then
              writes[#writes + 1] = data:sub(1, written)
            end
            free = free - written
            return true, written, free
          end,
        }
        local controller = require("g0b_raw").new({
          cc_api = cc_api,
          raw_codec = 0,
          now_ms = function() now = now + 10; return now end,
        })
        assert(controller:begin_call(1, 2) == true)
        assert(controller:start(2) == true)
        local first = controller:stats()
        assert(starts == 1 and first.written_bytes == 4096)
        assert(first.partial_writes == 1 and first.backpressure_events == 1)

        assert(controller:pump(0) == false)
        assert(controller:pump(1) == true)
        local blocked = controller:stats()
        assert(blocked.zero_writes == 1 and blocked.stale_generation_rejections == 1)

        free = 4096
        assert(controller:pump(1) == true)
        assert(controller:stats().written_bytes == 8192)
        free = 5000
        assert(controller:pump(1) == true)
        local complete = controller:stats()
        assert(complete.written_chunks == 2 and complete.written_bytes == 12800)
        assert(complete.sample_rate == 16000 and complete.chunk_size == 6400)
        assert(complete.requested_bytes == 12800)
        assert(complete.end_sent == true and complete.awaiting_done == true)
        assert(end_calls == 1 and starts == 1)

        local positive, negative = string.char(0, 16), string.char(0, 240)
        local first_pcm = string.rep(string.rep(positive, 8)
          .. string.rep(negative, 8), 200)
        local second_pcm = string.rep(string.rep(positive, 10)
          .. string.rep(negative, 10), 160)
        assert(table.concat(writes) == first_pcm .. second_pcm)
        assert(controller:on_ext_src_done(1) == true)
        assert(controller:stats().stream_done == true)
        assert(controller:start(1) == false)

        free = 4096
        assert(controller:begin_call(2, 1) == true)
        assert(controller:start(1) == true)
        local narrowband = controller:stats()
        assert(narrowband.written_bytes == 3200)
        assert(narrowband.sample_rate == 8000 and narrowband.chunk_size == 3200)
        assert(narrowband.requested_bytes == 3200)
        assert(sample_rates[1] == 16000 and sample_rates[2] == 8000)
        local before_clear = narrowband.written_bytes
        assert(controller:clear("host") == true and stops == 1)
        assert(controller:pump(2) == false)
        assert(controller:pump(1) == false)
        assert(controller:stats().written_bytes == before_clear)
        assert(controller:begin_call(1, 2) == false)
        assert(controller:begin_call(3, 0) == false)
        return "GATE0B_V2048_STREAM_PASS"
      `);
      expect(result).toBe("GATE0B_V2048_STREAM_PASS");
    } finally {
      lua.global.close();
    }
  });

  it("fails closed without cc.input or with a nonzero RAW codec", async () => {
    const factory = new LuaFactory();
    await factory.mountFile(
      "/firmware/g0b_raw.lua",
      readFirmware("gate0b/g0b_raw.lua"),
    );
    const lua = await factory.createEngine();
    try {
      const result = await lua.doString(`
        package.path = "/firmware/?.lua;" .. package.path
        local module = require("g0b_raw")
        local legacy_zbuff = { create = function() return {} end }
        local ok_without_input = pcall(module.new, {
          cc_api = { extern_source = function() return true end },
          zbuff_api = legacy_zbuff,
          raw_codec = 0,
        })
        local ok_wrong_codec = pcall(module.new, {
          cc_api = {
            extern_source = function() return true end,
            input = function() return true, 0, 0 end,
          },
          zbuff_api = legacy_zbuff,
          raw_codec = 99,
        })
        assert(ok_without_input == false and ok_wrong_codec == false)
        return "GATE0B_CAPABILITY_GUARD_PASS"
      `);
      expect(result).toBe("GATE0B_CAPABILITY_GUARD_PASS");
    } finally {
      lua.global.close();
    }
  });

  it("boots idle, dials once, and injects only after explicit START", async () => {
    const factory = new LuaFactory();
    for (const [source] of pocSources) {
      await factory.mountFile(`/firmware/${source}`, readFirmware(source));
    }
    const lua = await factory.createEngine();
    try {
      const result = await lua.doString(`
        package.path = "/firmware/gate0b/?.lua;" .. package.path
        local subscriptions, receive_callback, loops = {}, nil, {}
        local uart_input, fifo_free = "", 4096
        local init_calls, accept_calls, dial_calls, starts, stops = 0, 0, 0, 0, 0
        local dial_target = nil
        local writes, end_calls = {}, 0
        uart = {
          VUART_0 = 9,
          setup = function(id, baud, bits, stop)
            assert(id == 9 and baud == 115200 and bits == 8 and stop == 1)
            return 0
          end,
          on = function(_, event, callback)
            assert(event == "receive"); receive_callback = callback
          end,
          write = function(_, value) return #value end,
          read = function() local value = uart_input; uart_input = ""; return value end,
        }
        cc = {
          init = function() init_calls = init_calls + 1; return true end,
          quality = function() return 2 end,
          accept = function() accept_calls = accept_calls + 1; return true end,
          dial = function(sim_id, target)
            assert(sim_id == 0)
            dial_calls = dial_calls + 1
            dial_target = target
            return true
          end,
          hangUp = function() return true end,
          extern_source = function(source, add, codec, error_stop,
            sample_rate, bits, channels, signed)
            if source == nil then stops = stops + 1; return true end
            assert(source == true and add == true and codec == 0)
            assert(error_stop == true and sample_rate == 16000)
            assert(bits == 16 and channels == 1 and signed == true)
            starts = starts + 1
            return true
          end,
          input = function(is_record, data, is_end)
            assert(is_record == true and type(data) == "string")
            if is_end then end_calls = end_calls + 1; return true, 0, fifo_free end
            local written = math.min(#data, fifo_free)
            if written > 0 then writes[#writes + 1] = data:sub(1, written) end
            fifo_free = fifo_free - written
            return true, written, fifo_free
          end,
        }
        audio_v2 = { DATA_CODEC_TYPE_RAW = 0 }
        sys = {
          subscribe = function(topic, callback) subscriptions[topic] = callback end,
          timerStart = function() end,
          timerLoopStart = function(callback, interval) loops[interval] = callback end,
          taskInit = function(callback) callback() end,
          run = function() _G.sys_run_called = true end,
        }
        json = { encode = function(value) _G.last_json = value; return "{}" end }
        log = { info = function() end, error = function() end }
        gpio = { AUDIOPA_EN = 18 }
        mcu = { ticks2 = function() return 0, 200 end }
        rtos = {
          version = function() return "V2048" end,
          bsp = function() return "Air780EHV" end,
        }
        package.preload.air153C_wtd = function()
          return { init = function() end, feed_dog = function() end }
        end
        package.preload.exaudio = function()
          return {
            setup = function(config)
              assert(config.model == "es8311" and config.audio_mode == "new")
              return true
            end,
            get_audio_mode = function() return "audio_v2" end,
          }
        end

        dofile("/firmware/gate0b/main.lua")
        assert(sys_run_called == true and receive_callback ~= nil and loops[10])
        assert(init_calls == 0 and accept_calls == 0 and starts == 0)
        subscriptions.CC_IND("READY")
        assert(init_calls == 1 and starts == 0)
        uart_input = "SELFTEST\\n"
        receive_callback(9, #uart_input)
        assert(last_json.ok == true and last_json.command == "SELFTEST")
        uart_input = "DIAL INVALID\\n"
        receive_callback(9, #uart_input)
        assert(dial_calls == 0 and last_json.command == "DIAL")
        assert(last_json.ok == false)
        uart_input = "DIAL 000\\n"
        receive_callback(9, #uart_input)
        assert(dial_calls == 1 and dial_target == "000")
        assert(last_json.command == "DIAL" and last_json.ok == true)
        uart_input = "DIAL 111\\n"
        receive_callback(9, #uart_input)
        assert(dial_calls == 1 and dial_target == "000")
        assert(last_json.command == "DIAL" and last_json.ok == false)
        subscriptions.CC_IND("MAKE_CALL_OK")
        subscriptions.CC_IND("AUDIO_START")
        subscriptions.CC_IND("AUDIO_START")
        assert(last_json.call_generation == 1 and starts == 0 and accept_calls == 0)
        uart_input = "START 3\\n"
        receive_callback(9, #uart_input)
        assert(starts == 1)
        for _ = 1, 20 do
          if end_calls > 0 then break end
          fifo_free = 4096
          loops[10]()
        end
        assert(end_calls == 1 and #table.concat(writes) == 19200)
        subscriptions.CC_IND("EXT_SRC_DONE")
        uart_input = "STATS\\n"
        receive_callback(9, #uart_input)
        assert(last_json.controller.stream_done == true)
        return PROJECT .. ":" .. VERSION .. ":" .. tostring(stops)
      `);
      expect(result).toBe("WUJIE_AIR_GATE0B_STREAM:000.004.000:0");
    } finally {
      lua.global.close();
    }
  });
});
