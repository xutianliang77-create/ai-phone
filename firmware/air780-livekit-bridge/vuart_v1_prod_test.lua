local frame_codec = require("vuart_v1_codec")
local command_codec = require("vuart_v1_cmd_codec")
local runtime_module = require("vuart_v1_runtime")
local mock_carrier = require("vuart_v1_mock_cc")

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

local binding = {
    communication_session_id = "comm-1",
    provider_call_id = "air-call-1",
    device_id = "air-780-1",
    lease_id = "lease-1",
    fencing_token = 7,
    call_generation = 3,
}

local function dial(overrides)
    return merge(binding, {
        provider_operation_id = "operation-1",
        command_id = "command-1",
        idempotency_key = "air-command:comm-1:3:1",
        type = "dial",
        dial_target_e164 = "+8613800138000",
    }, overrides or {})
end

local function command_frame(command, sequence)
    local payload = must(command_codec.encode_command(command))
    local frame_type = command.type == "dial" and 3
        or command.type == "hangup" and 4 or 5
    return must(frame_codec.encode_frame({
        type = frame_type,
        flags = 0,
        sequence = sequence,
        timestamp_ms = tostring(1000 + sequence),
        payload = payload,
    }))
end

local function audio_uplink_frame(overrides, media_sequence, sequence)
    local input = merge(binding, overrides or {}, {
        media_sequence = media_sequence,
        pcm = string.rep("\3\4", 3200),
    })
    return must(frame_codec.encode_frame({
        type = 17, flags = 0, sequence = sequence,
        timestamp_ms = tostring(2000 + sequence),
        payload = must(frame_codec.encode_audio(input)),
    }))
end

local function make_runtime(options)
    options = options or {}
    local writes = {}
    local carrier = options.carrier or mock_carrier.new()
    local now = 1000
    local runtime = runtime_module.new({
        device_id = binding.device_id,
        boot_id = options.boot_id or "boot-1",
        firmware_version = "001.000.000",
        capability_flags = options.capability_flags or 3,
        max_payload_bytes = 8192,
        max_records = options.max_records or 32,
        initial_sequence = 0,
        now_ms = function()
            now = now + 1
            return tostring(now)
        end,
        uptime_ms = function() return tostring(now - 1000) end,
        write = function(bytes)
            if options.reject_writes then return false end
            writes[#writes + 1] = bytes
        end,
        carrier = carrier,
    })
    local function take_writes()
        local output = writes
        writes = {}
        return output
    end
    return runtime, carrier, take_writes
end

local function decoded_frame(value)
    return must(frame_codec.decode_frame(value))
end

local function error_code(value)
    local frame = decoded_frame(value)
    assert_equal(frame.type, 33, "ERROR frame type")
    return must(command_codec.decode_error(frame.payload)).error_code
end

local function assert_boot_frames()
    local runtime, _, take = make_runtime()
    runtime:start()
    local output = take()
    assert_equal(#output, 2, "startup frame count")
    local hello_frame = decoded_frame(output[1])
    local heartbeat_frame = decoded_frame(output[2])
    assert_equal(hello_frame.type, 1, "HELLO frame type")
    assert_equal(heartbeat_frame.type, 2, "HEARTBEAT frame type")
    local hello = must(command_codec.decode_hello(hello_frame.payload))
    local heartbeat = must(command_codec.decode_heartbeat(heartbeat_frame.payload))
    assert_equal(hello.boot_id, "boot-1", "HELLO boot")
    assert_equal(hello.capability_flags, 3, "evidence capability flags")
    assert_equal(hello.max_payload_bytes, 8192, "maximum payload")
    assert_equal(heartbeat.heartbeat_sequence, 0, "first heartbeat sequence")
    assert_equal(heartbeat.device_state, "ready", "first heartbeat state")
    assert_equal(heartbeat.active_binding, nil, "ready heartbeat binding")

    runtime:heartbeat()
    local periodic = take()
    assert_equal(#periodic, 2, "periodic frame count")
    local repeated_hello = must(command_codec.decode_hello(
        decoded_frame(periodic[1]).payload))
    assert_equal(repeated_hello.boot_id, hello.boot_id, "periodic HELLO boot")
    local next_heartbeat = must(command_codec.decode_heartbeat(
        decoded_frame(periodic[2]).payload))
    assert_equal(next_heartbeat.heartbeat_sequence, 1,
        "second heartbeat sequence")
end

local function assert_stream_and_replay()
    local runtime, carrier, take = make_runtime()
    runtime:start()
    take()
    local encoded = command_frame(dial(), 100)
    runtime:ingest(encoded:sub(1, 7))
    assert_equal(#take(), 0, "fragment must not produce reply")
    runtime:ingest(encoded:sub(8) .. encoded)
    local replies = take()
    assert_equal(#replies, 2, "sticky duplicate reply count")
    assert_equal(replies[1], replies[2], "cached ACK bytes")
    assert_equal(carrier.snapshot().dial, 1, "duplicate dial side effects")
    local ack_frame = decoded_frame(replies[1])
    assert_equal(ack_frame.type, 32, "ACK frame type")
    local ack = must(command_codec.decode_ack(ack_frame.payload))
    assert_equal(ack.request_frame_sequence, 100, "cached request sequence")
    assert_equal(ack.command_id, "command-1", "cached command id")

    runtime:quarantine()
    runtime:heartbeat()
    local quarantine_frames = take()
    assert_equal(decoded_frame(quarantine_frames[1]).type, 1,
        "quarantine periodic HELLO")
    local quarantined = must(command_codec.decode_heartbeat(
        decoded_frame(quarantine_frames[2]).payload))
    assert_equal(quarantined.device_state, "quarantined", "quarantine heartbeat")
    runtime:resume()
    runtime:ingest(encoded)
    assert_equal(take()[1], replies[1], "same-boot reconnect replay")
    assert_equal(carrier.snapshot().dial, 1, "reconnect dial side effects")
end

local function assert_crc_rejection()
    local runtime, carrier, take = make_runtime()
    runtime:start()
    take()
    local encoded = command_frame(dial(), 101)
    local corrupt = encoded:sub(1, -2)
        .. string.char((encoded:byte(-1) + 1) % 256)
    runtime:ingest("noise" .. corrupt)
    assert_equal(#take(), 0, "corrupt frame reply count")
    assert_equal(carrier.snapshot().dial, 0, "corrupt frame side effects")
    runtime:ingest(string.rep("x", 40000))
    assert_equal(#take(), 0, "oversized stream reply count")
    local metrics = runtime:metrics()
    assert_equal(metrics.stream.invalid_frames, 1, "invalid CRC count")
    assert_equal(metrics.stream.buffer_overflows, 1, "stream buffer overflow count")
    assert_equal(metrics.stream.buffered_bytes, 0, "parser buffer after corrupt frame")
    if metrics.stream.peak_buffered_bytes > metrics.stream.max_buffer_bytes then
        error("stream buffer exceeded its hard bound", 0)
    end
end

local function assert_conflicts()
    local runtime, carrier, take = make_runtime()
    runtime:start()
    take()
    runtime:ingest(command_frame(dial(), 110))
    take()

    runtime:ingest(command_frame(dial({
        dial_target_e164 = "+8613900139000",
    }), 111))
    assert_equal(error_code(take()[1]), "idempotency_conflict",
        "command id conflict")
    runtime:ingest(command_frame(dial({
        command_id = "command-2",
    }), 112))
    assert_equal(error_code(take()[1]), "idempotency_conflict",
        "idempotency key conflict")
    assert_equal(carrier.snapshot().dial, 1, "conflict dial side effects")
end

local function assert_stale_contexts()
    local runtime, carrier, take = make_runtime()
    runtime:start()
    take()
    runtime:ingest(command_frame(dial(), 120))
    take()
    carrier.set_state("ready")
    runtime:carrier_event("disconnected", "remote_hangup")
    take()

    runtime:ingest(command_frame(dial({
        provider_operation_id = "operation-redial",
        command_id = "command-redial",
        idempotency_key = "air-command:comm-1:3:redial",
    }), 121))
    assert_equal(error_code(take()[1]), "invalid_state",
        "same generation redial")
    assert_equal(carrier.snapshot().dial, 1, "same generation redial effects")

    local current = dial({
        lease_id = "lease-2", fencing_token = 8, call_generation = 4,
        provider_operation_id = "operation-2", command_id = "command-2",
        idempotency_key = "air-command:comm-1:4:2",
    })
    runtime:ingest(command_frame(current, 122))
    take()
    assert_equal(carrier.snapshot().dial, 2, "new generation dial count")

    for stale_fence = 1, 7 do
        runtime:ingest(command_frame(merge(current, {
            fencing_token = stale_fence,
            command_id = "stale-fence-" .. stale_fence,
            idempotency_key = "stale-fence-key-" .. stale_fence,
        }), 130 + stale_fence))
        assert_equal(error_code(take()[1]), "stale_fence",
            "stale fence " .. stale_fence)
    end
    for stale_generation = 0, 3 do
        runtime:ingest(command_frame(merge(current, {
            call_generation = stale_generation,
            command_id = "stale-generation-" .. stale_generation,
            idempotency_key = "stale-generation-key-" .. stale_generation,
        }), 140 + stale_generation))
        assert_equal(error_code(take()[1]), "stale_generation",
            "stale generation " .. stale_generation)
    end
    runtime:ingest(command_frame(merge(current, {
        communication_session_id = "comm-other",
        command_id = "wrong-binding",
        idempotency_key = "wrong-binding-key",
    }), 150))
    assert_equal(error_code(take()[1]), "binding_mismatch", "wrong binding")
    assert_equal(carrier.snapshot().dial, 2, "stale context side effects")
    local metrics = runtime:metrics()
    assert_equal(metrics.stale_fences, 7, "stale fence metric")
    assert_equal(metrics.stale_generations, 4, "stale generation metric")
end

local function assert_call_control()
    local runtime, carrier, take = make_runtime({ capability_flags = 15 })
    runtime:start()
    take()
    runtime:ingest(command_frame(dial(), 160))
    take()
    carrier.set_state("connected")
    runtime:carrier_event("connected", "none")
    local call_state = must(frame_codec.decode_call_state(
        decoded_frame(take()[1]).payload))
    assert_equal(call_state.carrier_state, "connected", "carrier state source")

    local pcm = string.rep("\1\2", 3200)
    assert_equal(runtime:audio_downlink(pcm), true, "downlink accepted")
    local audio_frame = decoded_frame(take()[1])
    assert_equal(audio_frame.type, 16, "downlink frame type")
    local audio = must(frame_codec.decode_audio(audio_frame.payload))
    assert_equal(audio.media_sequence, 0, "downlink media sequence")
    assert_equal(audio.pcm, pcm, "downlink PCM")
    assert_equal(runtime:audio_downlink("short"), false,
        "invalid downlink rejected")
    assert_equal(#take(), 0, "invalid downlink write count")

    runtime:ingest(audio_uplink_frame(nil, 0, 201))
    runtime:ingest(audio_uplink_frame(nil, 0, 202))
    runtime:ingest(audio_uplink_frame(nil, 2, 203))
    runtime:ingest(audio_uplink_frame(nil, 1, 204))
    runtime:ingest(audio_uplink_frame({ lease_id = "lease-stale" }, 3, 205))
    assert_equal(carrier.snapshot().audio_uplink, 2,
        "only ordered bound uplink effects")
    assert_equal(#take(), 0, "audio uplink reply isolation")

    local dtmf = merge(binding, {
        provider_operation_id = "operation-dtmf",
        command_id = "command-dtmf",
        idempotency_key = "air-command:comm-1:3:dtmf",
        type = "dtmf", digits = "12#A",
    })
    local encoded_dtmf = command_frame(dtmf, 161)
    runtime:ingest(encoded_dtmf .. encoded_dtmf)
    local dtmf_replies = take()
    assert_equal(dtmf_replies[1], dtmf_replies[2], "cached DTMF ACK")
    assert_equal(carrier.snapshot().dtmf, 1, "DTMF side effects")

    local hangup = merge(binding, {
        provider_operation_id = "operation-hangup",
        command_id = "command-hangup",
        idempotency_key = "air-command:comm-1:3:hangup",
        type = "hangup",
    })
    local encoded_hangup = command_frame(hangup, 162)
    runtime:ingest(encoded_hangup .. encoded_hangup)
    local hangup_replies = take()
    assert_equal(hangup_replies[1], hangup_replies[2], "cached HANGUP ACK")
    assert_equal(carrier.snapshot().hangup, 1, "HANGUP side effects")
    runtime:ingest(command_frame(merge(hangup, {
        provider_operation_id = "operation-hangup-2",
        command_id = "command-hangup-2",
        idempotency_key = "air-command:comm-1:3:hangup-2",
    }), 163))
    assert_equal(error_code(take()[1]), "invalid_state",
        "second unique HANGUP")
    assert_equal(carrier.snapshot().hangup, 1, "second HANGUP side effects")
    runtime:carrier_event("disconnected", "local_hangup")
    take()
    assert_equal(carrier.snapshot().uplink_stops, 1, "terminal uplink stop")
    assert_equal(runtime:audio_downlink(pcm), false,
        "terminal downlink rejected")
    local metrics = runtime:metrics()
    assert_equal(metrics.audio_downlink_frames, 1, "downlink frame count")
    assert_equal(metrics.audio_downlink_drops, 1, "invalid downlink drop")
    assert_equal(metrics.audio_without_binding, 1, "post-terminal downlink drop")
    assert_equal(metrics.audio_uplink_frames, 2, "uplink frame count")
    assert_equal(metrics.audio_uplink_duplicates, 1, "uplink duplicate count")
    assert_equal(metrics.audio_uplink_out_of_order, 1,
        "uplink out of order count")
    assert_equal(metrics.audio_uplink_gap_events, 1, "uplink gap count")
    assert_equal(metrics.audio_uplink_missing_chunks, 1,
        "uplink missing count")
    assert_equal(metrics.audio_uplink_binding_mismatches, 1,
        "uplink binding mismatch")
end

local function assert_default_capability_boundary()
    local runtime, carrier, take = make_runtime()
    runtime:start()
    take()
    runtime:ingest(command_frame(dial(), 165))
    take()
    carrier.set_state("connected")
    runtime:carrier_event("connected", "none")
    take()
    local dtmf = merge(binding, {
        provider_operation_id = "operation-no-dtmf",
        command_id = "command-no-dtmf",
        idempotency_key = "air-command:comm-1:3:no-dtmf",
        type = "dtmf", digits = "1#",
    })
    runtime:ingest(command_frame(dtmf, 166))
    assert_equal(error_code(take()[1]), "unsupported_command",
        "default DTMF capability")
    assert_equal(carrier.snapshot().dtmf, 0, "unsupported DTMF side effects")
end

local function assert_ledger_capacity_and_boot_boundary()
    local runtime, carrier, take = make_runtime({ max_records = 1 })
    runtime:start()
    take()
    local first = command_frame(dial(), 170)
    runtime:ingest(first)
    local first_reply = take()[1]
    local hangup = merge(binding, {
        provider_operation_id = "operation-hangup",
        command_id = "command-hangup",
        idempotency_key = "air-command:comm-1:3:hangup",
        type = "hangup",
    })
    runtime:ingest(command_frame(hangup, 171))
    assert_equal(error_code(take()[1]), "internal_error", "full ledger error")
    assert_equal(carrier.snapshot().hangup, 0, "full ledger side effects")
    runtime:ingest(first)
    assert_equal(take()[1], first_reply, "full ledger retained applied reply")
    assert_equal(carrier.snapshot().dial, 1, "full ledger dial side effects")
    assert_equal(runtime:metrics().ledger_records, 1, "bounded ledger records")

    local restarted, _, restarted_take = make_runtime({ boot_id = "boot-2" })
    restarted:start()
    local hello = must(command_codec.decode_hello(
        decoded_frame(restarted_take()[1]).payload))
    assert_equal(hello.boot_id, "boot-2", "new boot identity")
    assert_equal(restarted:metrics().ledger_records, 0, "new boot ledger boundary")
end

local function assert_carrier_error_boundary()
    local invalid_carrier = {
        dial = function()
            return { status = "rejected", error_code = "network_error" }
        end,
        hangup = function()
            return { status = "rejected", error_code = "network_error" }
        end,
        dtmf = function()
            return { status = "rejected", error_code = "network_error" }
        end,
        is_connected = function() return false end,
    }
    local runtime, _, take = make_runtime({ carrier = invalid_carrier })
    runtime:start()
    take()
    runtime:ingest(command_frame(dial(), 180))
    assert_equal(error_code(take()[1]), "internal_error",
        "invalid carrier error boundary")
    assert_equal(runtime:metrics().carrier_errors, 1,
        "invalid carrier error metric")
end

local function assert_transport_backpressure()
    local runtime, carrier = make_runtime({ reject_writes = true })
    runtime:start()
    assert_equal(runtime:metrics().write_rejections, 2,
        "startup write rejections")
    runtime:ingest(command_frame(dial(), 190))
    assert_equal(carrier.snapshot().dial, 1, "backpressure dial side effect")
    assert_equal(runtime:metrics().write_rejections, 3,
        "ACK write rejection")
    carrier.set_state("connected")
    runtime:carrier_event("connected", "none")
    assert_equal(runtime:metrics().write_rejections, 4,
        "carrier write rejection")
    local accepted, reason = runtime:audio_downlink(string.rep("a", 6400))
    assert_equal(accepted, false, "audio backpressure status")
    assert_equal(reason, "transport_backpressure", "audio backpressure reason")
    local metrics = runtime:metrics()
    assert_equal(metrics.write_rejections, 5, "audio write rejection")
    assert_equal(metrics.audio_downlink_frames, 1, "audio attempt metric")
    assert_equal(metrics.audio_downlink_drops, 1, "audio backpressure drop")
end

function M.run()
    assert_boot_frames()
    assert_stream_and_replay()
    assert_crc_rejection()
    assert_conflicts()
    assert_stale_contexts()
    assert_call_control()
    assert_default_capability_boundary()
    assert_ledger_capacity_and_boot_boundary()
    assert_carrier_error_boundary()
    assert_transport_backpressure()
    return { ok = true, status = "PURE_SOFTWARE_PASS" }
end

return M
