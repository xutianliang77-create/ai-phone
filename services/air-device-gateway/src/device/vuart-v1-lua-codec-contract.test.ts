import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const firmwareUrl = new URL(
  "../../../../firmware/air780-livekit-bridge/",
  import.meta.url,
);
const codec = readFileSync(new URL("vuart_v1_codec.lua", firmwareUrl), "utf8");
const selftest = readFileSync(
  new URL("vuart_v1_golden_selftest.lua", firmwareUrl),
  "utf8",
);
const vectors = readFileSync(
  new URL("vuart_v1_golden_vectors.lua", firmwareUrl),
  "utf8",
);
const commandCodec = readFileSync(
  new URL("vuart_v1_command_codec.lua", firmwareUrl),
  "utf8",
);
const commandSelftest = readFileSync(
  new URL("vuart_v1_command_golden_selftest.lua", firmwareUrl),
  "utf8",
);
const commandVectors = readFileSync(
  new URL("vuart_v1_command_golden_vectors.lua", firmwareUrl),
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

  it("checks both positive golden vectors and malformed payload rejection", () => {
    for (const assertion of [
      "golden.vectors.call_state_connected",
      "golden.vectors.audio_downlink_16k_200ms",
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

  it("keeps runtime execution explicitly pending", () => {
    expect(vectors).toContain("frozen_h0_node_lua_runtime_pending");
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
