local codec = require("vuart_v1_codec")
local golden = require("vuart_v1_golden_vectors")

local crypto = rawget(_G, "crypto")
if not crypto then
    local ok, loaded = pcall(require, "crypto")
    if ok then crypto = loaded end
end

local M = {}

local function assert_equal(actual, expected, name)
    if actual ~= expected then
        error(string.format("%s mismatch: expected=%s actual=%s",
            name, tostring(expected), tostring(actual)), 0)
    end
end

local function must(value, message)
    if not value then error(message or "operation failed", 0) end
    return value
end

local function merge(binding, fields)
    local output = {}
    for key, value in pairs(binding) do output[key] = value end
    for key, value in pairs(fields) do output[key] = value end
    return output
end

local function patterned_pcm()
    local bytes = {}
    for value = 0, 255 do bytes[#bytes + 1] = string.char(value) end
    return string.rep(table.concat(bytes), 25)
end

local function assert_rejected(operation, input, name)
    local value = operation(input)
    if value ~= nil then error(name .. " was accepted", 0) end
end

function M.run()
    if not crypto or type(crypto.sha256) ~= "function" then
        error("crypto.sha256 unavailable", 0)
    end

    local call = golden.vectors.call_state_connected
    local call_payload, call_error = codec.encode_call_state(merge(call.binding, {
        event_sequence = call.event_sequence,
        carrier_state = call.carrier_state,
        carrier_cause = call.carrier_cause,
    }))
    call_payload = must(call_payload, call_error)
    assert_equal(#call_payload, call.payload_bytes, "call payload bytes")
    assert_equal(codec.to_hex(call_payload), call.payload_hex, "call payload hex")

    local decoded_call = must(codec.decode_call_state(call_payload))
    assert_equal(decoded_call.event_sequence, call.event_sequence, "call event sequence")
    assert_equal(decoded_call.carrier_state, call.carrier_state, "carrier state")
    assert_equal(decoded_call.carrier_cause, call.carrier_cause, "carrier cause")

    local call_frame = must(codec.encode_frame({
        type = 6,
        flags = call.frame_flags,
        sequence = call.frame_sequence,
        timestamp_ms = call.timestamp_ms,
        payload = call_payload,
    }))
    assert_equal(#call_frame, call.frame_bytes, "call frame bytes")
    assert_equal(codec.to_hex(call_frame), call.frame_hex, "call frame hex")
    assert_equal(must(codec.decode_frame(call_frame)).payload, call_payload,
        "decoded call frame payload")

    local audio = golden.vectors.audio_downlink_16k_200ms
    local pcm = patterned_pcm()
    local audio_payload, audio_error = codec.encode_audio(merge(audio.binding, {
        media_sequence = audio.media_sequence,
        pcm = pcm,
    }))
    audio_payload = must(audio_payload, audio_error)
    assert_equal(#audio_payload, audio.payload_bytes, "audio payload bytes")
    assert_equal(crypto.sha256(audio_payload):lower(), audio.payload_sha256,
        "audio payload sha256")

    local decoded_audio = must(codec.decode_audio(audio_payload))
    assert_equal(decoded_audio.media_sequence, audio.media_sequence,
        "audio media sequence")
    assert_equal(decoded_audio.pcm, pcm, "audio PCM")

    local audio_frame = must(codec.encode_frame({
        type = 16,
        flags = audio.frame_flags,
        sequence = audio.frame_sequence,
        timestamp_ms = audio.timestamp_ms,
        payload = audio_payload,
    }))
    assert_equal(#audio_frame, audio.frame_bytes, "audio frame bytes")
    assert_equal(crypto.sha256(audio_frame):lower(), audio.frame_sha256,
        "audio frame sha256")
    assert_equal(must(codec.decode_frame(audio_frame)).payload, audio_payload,
        "decoded audio frame payload")

    assert_rejected(codec.decode_call_state,
        string.char(2) .. call_payload:sub(2), "bad payload version")
    assert_rejected(codec.decode_call_state,
        call_payload .. string.char(0), "trailing call byte")
    assert_rejected(codec.decode_call_state,
        call_payload:sub(1, -3) .. string.char(4, 0), "invalid state cause")
    local audio_tail = #audio_payload - 6400 - 12 + 1
    local bad_audio = audio_payload:sub(1, audio_tail + 3) .. string.char(0, 0)
        .. audio_payload:sub(audio_tail + 6)
    assert_rejected(codec.decode_audio, bad_audio, "bad audio sample rate")
    local corrupt_frame = call_frame:sub(1, -2)
        .. string.char((call_frame:byte(-1) + 1) % 256)
    assert_rejected(codec.decode_frame, corrupt_frame, "bad frame crc32")

    return {
        ok = true,
        schema = golden.schema,
        call_payload_hex = call.payload_hex,
        audio_payload_sha256 = audio.payload_sha256,
        audio_frame_sha256 = audio.frame_sha256,
    }
end

return M
