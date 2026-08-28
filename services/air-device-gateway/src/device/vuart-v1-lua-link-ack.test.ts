import { readFileSync } from "node:fs";
import { LuaFactory } from "wasmoon";
import { describe, expect, it } from "vitest";

const firmwareUrl = new URL(
  "../../../../firmware/air780-livekit-bridge/",
  import.meta.url,
);

const sources = [
  "vuart_v1_codec.lua",
  "vuart_v1_cmd_codec.lua",
  "vuart_v1_stream.lua",
  "vuart_v1_ledger.lua",
  "vuart_v1_runtime.lua",
] as const;

describe("Air780 VUART link acknowledgement", () => {
  it("accepts correlated HELLO/HEARTBEAT ACKs without carrier side effects", async () => {
    const factory = new LuaFactory();
    for (const source of sources) {
      await factory.mountFile(
        `/firmware/${source}`,
        readFileSync(new URL(source, firmwareUrl)),
      );
    }
    const lua = await factory.createEngine();
    try {
      const result = await lua.doString(`
        package.path = "/firmware/?.lua;" .. package.path
        crypto = {
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
        local codec = require("vuart_v1_codec")
        local writes, carrier_calls = {}, 0
        local runtime = require("vuart_v1_runtime").new({
          device_id = "air780-test",
          boot_id = "boot-test",
          firmware_version = "001.004.001",
          capability_flags = 7,
          max_payload_bytes = 8192,
          now_ms = function() return "100" end,
          uptime_ms = function() return "100" end,
          write = function(bytes) writes[#writes + 1] = bytes; return true end,
          carrier = {
            dial = function() carrier_calls = carrier_calls + 1 end,
            hangup = function() carrier_calls = carrier_calls + 1 end,
            dtmf = function() carrier_calls = carrier_calls + 1 end,
            audio_uplink = function() carrier_calls = carrier_calls + 1 end,
          },
        })
        runtime:start()
        assert(#writes == 2)
        local hello = assert(codec.decode_frame(writes[1]))
        local heartbeat = assert(codec.decode_frame(writes[2]))
        assert(hello.type == 1 and heartbeat.type == 2)

        local function ack(frame, transport_sequence)
          runtime:ingest(assert(codec.encode_frame({
            type = 34,
            flags = 0,
            sequence = transport_sequence,
            timestamp_ms = "101",
            payload = assert(codec.encode_link_ack({
              acknowledged_type = frame.type,
              acknowledged_sequence = frame.sequence,
              receiver_uptime_ms = "101",
            })),
          })))
        end
        ack(hello, 1000)
        ack(heartbeat, 1001)
        ack(heartbeat, 1002)
        local metrics = runtime:metrics()
        assert(metrics.link_acks_received == 2)
        assert(metrics.link_ack_duplicates == 1)
        assert(metrics.link_ack_invalid == 0)
        assert(carrier_calls == 0)
        return "VUART_LINK_ACK_PASS"
      `);
      expect(result).toBe("VUART_LINK_ACK_PASS");
    } finally {
      lua.global.close();
    }
  });
});
