local M = {}
local crypto = rawget(_G, "crypto")
local PAYLOAD_VERSION = 1
local FRAME_VERSION = 1
local SAMPLE_RATE_HZ = 16000
local DURATION_MS = 200
local CHANNELS = 1
local PCM_S16LE = 1
local PCM_BYTES = 6400
local MAX_SAFE_FENCE = 9007199254740991
local MAX_SAFE_FENCE_DECIMAL = "9007199254740991"
local MAX_UINT64_DECIMAL = "18446744073709551615"
local ID_FIELDS = {
    { "communication_session_id", 160 },
    { "provider_call_id", 200 },
    { "device_id", 128 },
    { "lease_id", 128 },
}
local STATE_TO_CODE = {
    dialing = 1, ringing = 2, connected = 3, disconnected = 4,
    busy = 5, failed = 6, unknown = 7,
}
local CODE_TO_STATE = {
    [1] = "dialing", [2] = "ringing", [3] = "connected",
    [4] = "disconnected", [5] = "busy", [6] = "failed", [7] = "unknown",
}
local CAUSE_TO_CODE = {
    none = 0, local_hangup = 1, remote_hangup = 2, busy = 3,
    no_answer = 4, rejected = 5, network_error = 6, device_error = 7,
    unknown = 255,
}
local CODE_TO_CAUSE = {
    [0] = "none", [1] = "local_hangup", [2] = "remote_hangup",
    [3] = "busy", [4] = "no_answer", [5] = "rejected",
    [6] = "network_error", [7] = "device_error", [255] = "unknown",
}
local function fail(message)
    error("vuart_v1: " .. message, 0)
end

local function require_value(condition, message)
    if not condition then fail(message) end
end
local function is_uint(value, maximum)
    return type(value) == "number" and value >= 0 and value <= maximum
        and value == math.floor(value)
end

local function encode_u16_le(value)
    require_value(is_uint(value, 0xFFFF), "uint16 out of range")
    return string.char(value % 256, math.floor(value / 256) % 256)
end

local function encode_u32_le(value)
    require_value(is_uint(value, 0xFFFFFFFF), "uint32 out of range")
    local bytes = {}
    for index = 1, 4 do
        bytes[index] = string.char(value % 256)
        value = math.floor(value / 256)
    end
    return table.concat(bytes)
end

local function normalize_decimal(value)
    if type(value) == "number" then
        require_value(is_uint(value, MAX_SAFE_FENCE), "unsafe decimal number")
        return string.format("%.0f", value)
    end
    require_value(type(value) == "string" and value:match("^%d+$"),
        "decimal uint64 required")
    value = value:gsub("^0+", "")
    if value == "" then value = "0" end
    require_value(#value < #MAX_UINT64_DECIMAL or
        (#value == #MAX_UINT64_DECIMAL and value <= MAX_UINT64_DECIMAL),
        "uint64 out of range")
    return value
end

local function divide_decimal_by_256(value)
    local quotient, carry, started = {}, 0, false
    for index = 1, #value do
        local current = carry * 10 + tonumber(value:sub(index, index))
        local digit = math.floor(current / 256)
        carry = current % 256
        if digit ~= 0 or started then
            quotient[#quotient + 1] = tostring(digit)
            started = true
        end
    end
    return started and table.concat(quotient) or "0", carry
end

local function encode_u64_decimal_le(value)
    value = normalize_decimal(value)
    local bytes = {}
    for index = 1, 8 do
        local quotient, remainder = divide_decimal_by_256(value)
        bytes[index] = string.char(remainder)
        value = quotient
    end
    require_value(value == "0", "uint64 overflow")
    return table.concat(bytes)
end

local function decimal_multiply_add(value, multiplier, addend)
    local output, carry = {}, addend
    for index = #value, 1, -1 do
        local current = tonumber(value:sub(index, index)) * multiplier + carry
        table.insert(output, 1, tostring(current % 10))
        carry = math.floor(current / 10)
    end
    while carry > 0 do
        table.insert(output, 1, tostring(carry % 10))
        carry = math.floor(carry / 10)
    end
    return table.concat(output):gsub("^0+(%d)", "%1")
end

local function decode_u64_decimal_le(bytes)
    local value = "0"
    for index = 8, 1, -1 do
        value = decimal_multiply_add(value, 256, bytes:byte(index))
    end
    return value
end

local function new_reader(data)
    require_value(type(data) == "string", "binary string required")
    return { data = data, position = 1 }
end

local function read_bytes(reader, length, name)
    require_value(is_uint(length, 0xFFFF) and
        reader.position + length - 1 <= #reader.data, "truncated at " .. name)
    local value = reader.data:sub(reader.position, reader.position + length - 1)
    reader.position = reader.position + length
    return value
end

local function read_u8(reader, name)
    return read_bytes(reader, 1, name):byte(1)
end

local function read_u16_le(reader, name)
    local value = read_bytes(reader, 2, name)
    return value:byte(1) + value:byte(2) * 256
end

local function read_u32_le(reader, name)
    local value = read_bytes(reader, 4, name)
    return value:byte(1) + value:byte(2) * 256 + value:byte(3) * 65536
        + value:byte(4) * 16777216
end

local function read_u64_safe(reader, name)
    local decimal = decode_u64_decimal_le(read_bytes(reader, 8, name))
    require_value(#decimal < #MAX_SAFE_FENCE_DECIMAL or
        (#decimal == #MAX_SAFE_FENCE_DECIMAL and decimal <= MAX_SAFE_FENCE_DECIMAL),
        name .. " outside safe integer range")
    local value = tonumber(decimal)
    require_value(value and value >= 1, name .. " must be positive")
    return value
end

local function read_identifier(reader, name, maximum)
    local length = read_u8(reader, name .. "_length")
    require_value(length >= 1 and length <= maximum, name .. " length invalid")
    local value = read_bytes(reader, length, name)
    require_value(value:match("^[A-Za-z0-9][A-Za-z0-9._:%-]*$"),
        name .. " must be canonical ASCII")
    return value
end

local function assert_end(reader)
    require_value(reader.position == #reader.data + 1, "trailing payload bytes")
end

local function validate_identifier(value, name, maximum)
    require_value(type(value) == "string" and #value >= 1 and #value <= maximum
        and value:match("^[A-Za-z0-9][A-Za-z0-9._:%-]*$"),
        name .. " must be bounded canonical ASCII")
end

local function encode_binding(input)
    require_value(type(input) == "table", "binding table required")
    require_value(is_uint(input.call_generation, 0xFFFFFFFF),
        "call_generation must be uint32")
    require_value(is_uint(input.fencing_token, MAX_SAFE_FENCE) and
        input.fencing_token >= 1, "fencing_token outside safe range")
    local output = { string.char(PAYLOAD_VERSION),
        encode_u32_le(input.call_generation),
        encode_u64_decimal_le(input.fencing_token) }
    for _, field in ipairs(ID_FIELDS) do
        local name, maximum = field[1], field[2]
        local value = input[name]
        validate_identifier(value, name, maximum)
        output[#output + 1] = string.char(#value) .. value
    end
    return table.concat(output)
end

local function decode_binding(reader)
    require_value(read_u8(reader, "payload_version") == PAYLOAD_VERSION,
        "payload version unsupported")
    local output = {
        call_generation = read_u32_le(reader, "call_generation"),
        fencing_token = read_u64_safe(reader, "fencing_token"),
    }
    for _, field in ipairs(ID_FIELDS) do
        output[field[1]] = read_identifier(reader, field[1], field[2])
    end
    return output
end

local function valid_state_cause(state, cause)
    if state == "dialing" or state == "ringing" or state == "connected" then
        return cause == "none"
    elseif state == "disconnected" then
        return cause == "local_hangup" or cause == "remote_hangup"
            or cause == "no_answer" or cause == "rejected" or cause == "unknown"
    elseif state == "busy" then
        return cause == "busy"
    elseif state == "failed" then
        return cause == "network_error" or cause == "device_error" or cause == "unknown"
    end
    return state == "unknown" and cause == "unknown"
end

local function protect(operation, input)
    local ok, result = pcall(operation, input)
    if not ok then return nil, result end
    return result
end

function M.encode_call_state(input)
    return protect(function(value)
        require_value(is_uint(value.event_sequence, 0xFFFFFFFF),
            "event_sequence must be uint32")
        require_value(valid_state_cause(value.carrier_state, value.carrier_cause),
            "carrier state and cause invalid")
        return encode_binding(value) .. encode_u32_le(value.event_sequence)
            .. string.char(STATE_TO_CODE[value.carrier_state],
                CAUSE_TO_CODE[value.carrier_cause])
    end, input)
end

function M.decode_call_state(payload)
    return protect(function(value)
        local reader = new_reader(value)
        local output = decode_binding(reader)
        output.event_sequence = read_u32_le(reader, "event_sequence")
        output.carrier_state = CODE_TO_STATE[read_u8(reader, "carrier_state")]
        output.carrier_cause = CODE_TO_CAUSE[read_u8(reader, "carrier_cause")]
        require_value(valid_state_cause(output.carrier_state, output.carrier_cause),
            "carrier state and cause invalid")
        assert_end(reader)
        return output
    end, payload)
end

function M.encode_audio(input)
    return protect(function(value)
        require_value(is_uint(value.media_sequence, 0xFFFFFFFF),
            "media_sequence must be uint32")
        require_value(type(value.pcm) == "string" and #value.pcm == PCM_BYTES,
            "audio PCM must contain exactly 6400 bytes")
        return encode_binding(value) .. encode_u32_le(value.media_sequence)
            .. encode_u16_le(SAMPLE_RATE_HZ) .. encode_u16_le(DURATION_MS)
            .. string.char(CHANNELS, PCM_S16LE) .. encode_u16_le(PCM_BYTES)
            .. value.pcm
    end, input)
end

function M.decode_audio(payload)
    return protect(function(value)
        local reader = new_reader(value)
        local output = decode_binding(reader)
        output.media_sequence = read_u32_le(reader, "media_sequence")
        require_value(read_u16_le(reader, "sample_rate_hz") == SAMPLE_RATE_HZ
            and read_u16_le(reader, "duration_ms") == DURATION_MS
            and read_u8(reader, "channels") == CHANNELS
            and read_u8(reader, "sample_format") == PCM_S16LE
            and read_u16_le(reader, "pcm_byte_length") == PCM_BYTES,
            "audio metadata unsupported")
        output.pcm = read_bytes(reader, PCM_BYTES, "pcm")
        assert_end(reader)
        return output
    end, payload)
end

local function require_crypto(name)
    require_value(crypto and type(crypto[name]) == "function",
        "crypto." .. name .. " unavailable")
end

function M.encode_frame(input)
    return protect(function(value)
        require_value(is_uint(value.type, 0xFF), "frame type invalid")
        require_value(is_uint(value.flags, 0xFFFF), "frame flags invalid")
        require_value(is_uint(value.sequence, 0xFFFFFFFF), "frame sequence invalid")
        require_value(type(value.payload) == "string" and #value.payload <= 0xFFFF,
            "frame payload invalid")
        local header = "AI" .. string.char(FRAME_VERSION, value.type)
            .. encode_u16_le(value.flags) .. encode_u32_le(value.sequence)
            .. encode_u64_decimal_le(value.timestamp_ms)
            .. encode_u16_le(#value.payload)
        local body = header .. value.payload
        require_crypto("crc32")
        local checksum = crypto.crc32(body)
        if checksum < 0 then checksum = checksum + 4294967296 end
        return body .. encode_u32_le(checksum)
    end, input)
end

function M.decode_frame(frame)
    return protect(function(value)
        local reader = new_reader(value)
        require_value(read_bytes(reader, 2, "magic") == "AI", "frame magic mismatch")
        require_value(read_u8(reader, "version") == FRAME_VERSION,
            "frame version unsupported")
        local output = {
            type = read_u8(reader, "type"),
            flags = read_u16_le(reader, "flags"),
            sequence = read_u32_le(reader, "sequence"),
            timestamp_ms = decode_u64_decimal_le(read_bytes(reader, 8, "timestamp_ms")),
        }
        local payload_length = read_u16_le(reader, "payload_length")
        output.payload = read_bytes(reader, payload_length, "payload")
        local expected_crc = read_u32_le(reader, "crc32")
        assert_end(reader)
        require_crypto("crc32")
        local actual_crc = crypto.crc32(value:sub(1, #value - 4))
        if actual_crc < 0 then actual_crc = actual_crc + 4294967296 end
        require_value(expected_crc == actual_crc, "frame crc32 mismatch")
        return output
    end, frame)
end

function M.to_hex(data)
    require_value(type(data) == "string", "binary string required")
    return (data:gsub(".", function(character)
        return string.format("%02x", character:byte())
    end))
end

return M
