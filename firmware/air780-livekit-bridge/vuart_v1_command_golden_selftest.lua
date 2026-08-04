local codec = require("vuart_v1_command_codec")
local frame_codec = require("vuart_v1_codec")
local golden = require("vuart_v1_command_golden_vectors")

local M = {}

local function must(value, message)
    if not value then error(message or "operation failed", 0) end
    return value
end

local function assert_equal(actual, expected, name)
    if actual ~= expected then
        error(string.format("%s mismatch: expected=%s actual=%s",
            name, tostring(expected), tostring(actual)), 0)
    end
end

local function merge(...)
    local output = {}
    for index = 1, select("#", ...) do
        for key, value in pairs(select(index, ...)) do output[key] = value end
    end
    return output
end

local function assert_rejected(operation, input, second, name)
    local value
    if second ~= nil then value = operation(input, second) else value = operation(input) end
    if value ~= nil then error(name .. " was accepted", 0) end
end

local function assert_vector(name, payload)
    local vector = golden.vectors[name]
    assert_equal(frame_codec.to_hex(payload), vector.payload_hex,
        name .. " payload hex")
    local frame = must(frame_codec.encode_frame({
        type = vector.frame_type,
        flags = 0,
        sequence = vector.frame_sequence,
        timestamp_ms = vector.timestamp_ms,
        payload = payload,
    }))
    assert_equal(frame_codec.to_hex(frame), vector.frame_hex, name .. " frame hex")
    assert_equal(must(frame_codec.decode_frame(frame)).payload, payload,
        name .. " decoded frame payload")
end

function M.run()
    local vectors = golden.vectors
    local hello = must(codec.encode_hello({
        device_id = "air-780-1",
        boot_id = "boot-1",
        firmware_version = "000.999.007",
        protocol_version = 1,
        capability_flags = 3,
        max_payload_bytes = 6461,
    }))
    assert_vector("hello", hello)
    assert_equal(must(codec.decode_hello(hello)).capability_flags, 3,
        "hello capability flags")

    local heartbeat = must(codec.encode_heartbeat({
        device_id = "air-780-1",
        boot_id = "boot-1",
        heartbeat_sequence = 0x01020304,
        uptime_ms = "72623859790382856",
        device_state = "in_call",
        active_binding = golden.binding,
    }))
    assert_vector("heartbeat_in_call", heartbeat)
    local decoded_heartbeat = must(codec.decode_heartbeat(heartbeat))
    assert_equal(decoded_heartbeat.uptime_ms, "72623859790382856", "heartbeat uptime")
    assert_equal(decoded_heartbeat.active_binding.lease_id, golden.binding.lease_id,
        "heartbeat lease")

    local dial_input = merge(golden.binding, golden.context, {
        type = "dial", dial_target_e164 = "+8613800138000",
    })
    local dial = must(codec.encode_command(dial_input))
    assert_vector("dial", dial)
    assert_equal(must(codec.decode_command(3, dial)).dial_target_e164,
        dial_input.dial_target_e164, "dial target")

    local hangup_input = merge(golden.binding, golden.context, { type = "hangup" })
    local hangup = must(codec.encode_command(hangup_input))
    assert_vector("hangup", hangup)
    assert_equal(must(codec.decode_command(4, hangup)).type, "hangup", "hangup type")

    local dtmf_input = merge(golden.binding, golden.context, {
        type = "dtmf", digits = "12#A",
    })
    local dtmf = must(codec.encode_command(dtmf_input))
    assert_vector("dtmf", dtmf)
    assert_equal(must(codec.decode_command(5, dtmf)).digits, "12#A", "DTMF digits")

    local ack_input = merge(golden.binding, golden.context, {
        request_frame_sequence = 0x10203040,
        command_type = "dial",
        result = "applied",
    })
    local ack = must(codec.encode_ack(ack_input))
    assert_vector("ack_dial", ack)
    assert_equal(must(codec.decode_ack(ack)).result, "applied", "ACK result")

    local error_input = merge(golden.binding, golden.context, {
        request_frame_sequence = 0x11223344,
        command_type = "dial",
        error_code = "idempotency_conflict",
    })
    local error_payload = must(codec.encode_error(error_input))
    assert_vector("error_conflict", error_payload)
    assert_equal(must(codec.decode_error(error_payload)).error_code,
        "idempotency_conflict", "ERROR code")

    assert_rejected(codec.encode_hello, {
        device_id = "air-780-1", boot_id = "boot-1",
        firmware_version = "000.999.007", protocol_version = 1,
        capability_flags = 16, max_payload_bytes = 6461,
    }, nil, "unknown capability")
    assert_rejected(codec.encode_heartbeat, {
        device_id = "air-780-1", boot_id = "boot-1", heartbeat_sequence = 1,
        uptime_ms = "1", device_state = "in_call",
    }, nil, "in-call heartbeat without binding")
    assert_rejected(codec.encode_command,
        merge(dial_input, { dial_target_e164 = "13800138000" }), nil,
        "non-E.164 dial")
    assert_rejected(codec.encode_command,
        merge(dtmf_input, { digits = "12X" }), nil, "invalid DTMF")
    assert_rejected(codec.decode_command, 4, hangup .. string.char(0),
        "trailing command byte")
    assert_rejected(codec.decode_command, 6, hangup, "unsupported command type")

    return {
        ok = true,
        schema = golden.schema,
        hello_payload_hex = vectors.hello.payload_hex,
        heartbeat_payload_hex = vectors.heartbeat_in_call.payload_hex,
        dial_payload_hex = vectors.dial.payload_hex,
        hangup_payload_hex = vectors.hangup.payload_hex,
        dtmf_payload_hex = vectors.dtmf.payload_hex,
        ack_payload_hex = vectors.ack_dial.payload_hex,
        error_payload_hex = vectors.error_conflict.payload_hex,
    }
end

return M
