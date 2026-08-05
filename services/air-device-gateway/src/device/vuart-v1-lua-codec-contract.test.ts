import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const firmwareUrl = new URL(
  "../../../../firmware/air780-livekit-bridge/",
  import.meta.url,
);
const codec = readFileSync(new URL("vuart_v1_codec.lua", firmwareUrl), "utf8");
const selftest = readFileSync(
  new URL("vuart_v1_golden_test.lua", firmwareUrl),
  "utf8",
);
const vectors = readFileSync(
  new URL("vuart_v1_golden_vec.lua", firmwareUrl),
  "utf8",
);
const commandCodec = readFileSync(
  new URL("vuart_v1_cmd_codec.lua", firmwareUrl),
  "utf8",
);
const commandSelftest = readFileSync(
  new URL("vuart_v1_cmd_test.lua", firmwareUrl),
  "utf8",
);
const commandVectors = readFileSync(
  new URL("vuart_v1_cmd_vec.lua", firmwareUrl),
  "utf8",
);
const runtimeMain = readFileSync(new URL("main.lua", firmwareUrl), "utf8");
const runtimeSelftest = readFileSync(
  new URL("vuart_v1_rt_test.lua", firmwareUrl),
  "utf8",
);
const runtimeManifest = readFileSync(
  new URL("SELFTEST_MANIFEST.sha256", firmwareUrl),
  "utf8",
);

describe("Air VUART v1 Lua codec static contract", () => {
  it("exports the frozen session payload and envelope operations", () => {
    for (const operation of [
      "encode_call_state",
      "decode_call_state",
      "encode_audio",
      "decode_audio",
      "encode_frame",
      "decode_frame",
      "to_hex",
    ]) {
      expect(codec).toContain(`function M.${operation}`);
    }
    expect(codec).toContain("PAYLOAD_VERSION = 1");
    expect(codec).toContain("SAMPLE_RATE_HZ = 16000");
    expect(codec).toContain("DURATION_MS = 200");
    expect(codec).toContain("PCM_BYTES = 6400");
    expect(codec).toContain("MAX_SAFE_FENCE = 9007199254740991");
  });

  it("uses explicit little-endian bytes and official crypto boundaries", () => {
    expect(codec).toContain("encode_u16_le");
    expect(codec).toContain("encode_u32_le");
    expect(codec).toContain("encode_u64_decimal_le");
    expect(codec).toContain("crypto.crc32");
    expect(selftest).toContain("crypto.sha256");
  });

  it("uses the LuatOS crypto core library without an explicit require", () => {
    for (const source of [codec, selftest, runtimeMain, runtimeSelftest]) {
      expect(source).not.toMatch(/require\s*\(\s*["']crypto["']\s*\)/);
    }
  });

  it("checks both positive golden vectors and malformed payload rejection", () => {
    for (const assertion of [
      "golden.vectors.call_state_connected",
      "golden.vectors.audio_downlink_16k_200ms",
      "golden.vectors.audio_uplink_16k_200ms",
      "call.payload_hex",
      "call.frame_hex",
      "audio.payload_sha256",
      "audio.frame_sha256",
      "assert_rejected",
    ]) {
      expect(selftest).toContain(assertion);
    }
  });

  it("does not import diagnostic or ad-hoc text protocols", () => {
    expect(codec).not.toContain("WJAI/1");
    expect(codec).not.toMatch(/json\.(encode|decode)/);
    expect(selftest).not.toContain("WJAI/1");
  });

  it("keeps the new uplink vector board execution explicitly pending", () => {
    expect(vectors).toContain("frozen_h3_node_lua_host_pass_board_pending");
    expect(vectors).not.toContain("node_lua_golden_pass");
  });
});

describe("Air VUART v1 Lua command codec static contract", () => {
  it("exports every frozen status, command, and correlated result operation", () => {
    for (const operation of [
      "encode_hello", "decode_hello", "encode_heartbeat", "decode_heartbeat",
      "encode_command", "decode_command", "encode_ack", "decode_ack",
      "encode_error", "decode_error",
    ]) {
      expect(commandCodec).toContain(`function M.${operation}`);
    }
  });

  it("consumes all command golden vectors and keeps runtime pending", () => {
    for (const vector of [
      "hello", "heartbeat_in_call", "dial", "hangup", "dtmf", "ack_dial",
      "error_conflict",
    ]) {
      expect(commandSelftest).toContain(`vectors.${vector}`);
    }
    expect(commandSelftest).toContain("assert_rejected");
    expect(commandVectors).toContain("frozen_h0_node_lua_runtime_pending");
    expect(commandVectors).not.toContain("node_lua_golden_pass");
  });

  it("does not import diagnostic or ad-hoc text protocols", () => {
    expect(commandCodec).not.toContain("WJAI/1");
    expect(commandCodec).not.toMatch(/json\.(encode|decode)/);
    expect(commandSelftest).not.toContain("WJAI/1");
  });
});

describe("Air VUART v1 target self-test runtime contract", () => {
  it("runs both frozen suites and only passes when both succeed", () => {
    expect(runtimeSelftest).toContain('require("vuart_v1_golden_test")');
    expect(runtimeSelftest).toContain(
      'require("vuart_v1_cmd_test")',
    );
    expect(runtimeSelftest).toContain("pcall(operation)");
    expect(runtimeSelftest).toContain("run_suite(session_selftest.run)");
    expect(runtimeSelftest).toContain("run_suite(command_selftest.run)");
    expect(runtimeSelftest).toContain("session.ok and command.ok");
  });

  it("boots as an isolated board validation runtime without a text VUART", () => {
    expect(runtimeMain).toContain('PROJECT = "WUJIE_AIR_VUART_V1_SELFTEST"');
    expect(runtimeMain).toContain('require("vuart_v1_rt_test")');
    expect(runtimeMain).toContain("sys.taskInit(run_selftest)");
    expect(runtimeMain).toContain("air153C_wtd");
    expect(runtimeMain).not.toContain("WJAI/1");
    expect(runtimeMain).not.toContain("uart.setup");
    expect(runtimeMain).not.toMatch(/cc\.(dial|accept|hangUp)/);
  });

  it("does not hard-code a target-runtime PASS before the board run", () => {
    expect(runtimeMain).not.toContain("NODE_LUA_GOLDEN_PASS");
    expect(runtimeSelftest).not.toContain("NODE_LUA_GOLDEN_PASS");
  });

  it("pins every Lua file in the board self-test bundle by SHA-256", () => {
    const requiredFiles = [
      "main.lua",
      "vuart_v1_codec.lua",
      "vuart_v1_cmd_codec.lua",
      "vuart_v1_cmd_test.lua",
      "vuart_v1_cmd_vec.lua",
      "vuart_v1_golden_test.lua",
      "vuart_v1_golden_vec.lua",
      "vuart_v1_rt_test.lua",
    ];
    for (const file of requiredFiles) {
      expect(Buffer.byteLength(file, "utf8")).toBeLessThanOrEqual(24);
    }
    const entries = runtimeManifest.trim().split("\n").map((line) => {
      const match = line.match(/^([0-9a-f]{64})  ([A-Za-z0-9_.-]+)$/);
      expect(match).not.toBeNull();
      return { hash: match![1], file: match![2] };
    });
    expect(entries.map(({ file }) => file)).toEqual(requiredFiles);
    for (const { file, hash } of entries) {
      const bytes = readFileSync(new URL(file, firmwareUrl));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    }
  });
});
