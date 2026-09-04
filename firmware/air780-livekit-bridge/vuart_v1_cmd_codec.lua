-- Keep this filename within Luatools' 24-byte limit.
local M = {}
local VERSION = 1
local MIN_AUDIO_PAYLOAD_BYTES = 6461
local MAX_SAFE_FENCE = 9007199254740991
local MAX_SAFE_FENCE_DECIMAL = "9007199254740991"
local MAX_UINT64_DECIMAL = "18446744073709551615"
local DEVICE_STATE = { ready = 1, in_call = 2, quarantined = 3, fault = 4 }
local STATE_CODE = { [1] = "ready", [2] = "in_call", [3] = "quarantined", [4] = "fault" }
local COMMAND_TYPE = { dial = 3, hangup = 4, dtmf = 5 }
local TYPE_COMMAND = { [3] = "dial", [4] = "hangup", [5] = "dtmf" }
local ERROR_CODE = { unsupported_command = 1, stale_fence = 2, binding_mismatch = 3,
    stale_generation = 4, idempotency_conflict = 5, invalid_state = 6, invalid_argument = 7, internal_error = 8,
}
local CODE_ERROR = {
    [1] = "unsupported_command", [2] = "stale_fence", [3] = "binding_mismatch",
    [4] = "stale_generation", [5] = "idempotency_conflict", [6] = "invalid_state",
    [7] = "invalid_argument", [8] = "internal_error",
}
local function fail(message) error("vuart_v1_command: " .. message, 0) end
local function require_value(condition, message) if not condition then fail(message) end end
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
    local output = {}
    for index = 1, 4 do
        output[index] = string.char(value % 256)
        value = math.floor(value / 256)
    end
    return table.concat(output)
end
local function normalize_decimal(value, safe_only)
    if type(value) == "number" then
        require_value(is_uint(value, MAX_SAFE_FENCE), "unsafe decimal number")
        value = string.format("%.0f", value)
    end
    require_value(type(value) == "string" and value:match("^%d+$"),
        "decimal uint64 required")
    value = value:gsub("^0+", "")
    if value == "" then value = "0" end
    local maximum = safe_only and MAX_SAFE_FENCE_DECIMAL or MAX_UINT64_DECIMAL
    require_value(#value < #maximum or (#value == #maximum and value <= maximum),
        "uint64 out of range")
    return value
end
local function divide_decimal_by_256(value)
    local output, carry, started = {}, 0, false
    for index = 1, #value do
        local current = carry * 10 + tonumber(value:sub(index, index))
        local digit = math.floor(current / 256)
        carry = current % 256
        if digit ~= 0 or started then
            output[#output + 1] = tostring(digit)
            started = true
        end
    end
    return started and table.concat(output) or "0", carry
end
local function encode_u64_decimal_le(value, safe_only)
    value = normalize_decimal(value, safe_only)
    local output = {}
    for index = 1, 8 do
        local quotient, remainder = divide_decimal_by_256(value)
        output[index], value = string.char(remainder), quotient
    end
    require_value(value == "0", "uint64 overflow")
    return table.concat(output)
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
local function read_u8(reader, name) return read_bytes(reader, 1, name):byte(1) end
local function read_u16_le(reader, name)
    local value = read_bytes(reader, 2, name)
    return value:byte(1) + value:byte(2) * 256
end
local function read_u32_le(reader, name)
    local value = read_bytes(reader, 4, name)
    return value:byte(1) + value:byte(2) * 256 + value:byte(3) * 65536
        + value:byte(4) * 16777216
end
local function read_u64_decimal(reader, name)
    return decode_u64_decimal_le(read_bytes(reader, 8, name))
end
local function read_u64_safe(reader, name)
    local value = read_u64_decimal(reader, name)
    require_value(#value < #MAX_SAFE_FENCE_DECIMAL or
        (#value == #MAX_SAFE_FENCE_DECIMAL and value <= MAX_SAFE_FENCE_DECIMAL),
        name .. " outside safe integer range")
    local number = tonumber(value)
    require_value(number and number >= 1, name .. " must be positive")
    return number
end
local function valid_identifier(value, maximum)
    return type(value) == "string" and #value >= 1 and #value <= maximum
        and value:match("^[A-Za-z0-9][A-Za-z0-9._:%-]*$")
end
local function encode_identifier(value, maximum, name)
    require_value(valid_identifier(value, maximum), name .. " invalid")
    return string.char(#value) .. value
end
local function read_identifier(reader, maximum, name)
    local length = read_u8(reader, name .. "_length")
    require_value(length >= 1 and length <= maximum, name .. " length invalid")
    local value = read_bytes(reader, length, name)
    require_value(valid_identifier(value, maximum), name .. " invalid")
    return value
end
local function assert_end(reader)
    require_value(reader.position == #reader.data + 1, "trailing payload bytes")
end
local function protect(operation, input, second)
    local ok, result = pcall(operation, input, second)
    if not ok then return nil, result end
    return result
end
local function encode_binding(input)
    require_value(type(input) == "table", "binding table required")
    require_value(is_uint(input.call_generation, 0xFFFFFFFF),
        "call_generation must be uint32")
    require_value(is_uint(input.fencing_token, MAX_SAFE_FENCE) and
        input.fencing_token >= 1, "fencing_token outside safe range")
    return string.char(VERSION) .. encode_u32_le(input.call_generation)
        .. encode_u64_decimal_le(input.fencing_token, true)
        .. encode_identifier(input.communication_session_id, 160,
            "communication_session_id")
        .. encode_identifier(input.provider_call_id, 200, "provider_call_id")
        .. encode_identifier(input.device_id, 128, "device_id")
        .. encode_identifier(input.lease_id, 128, "lease_id")
end
local function decode_binding(reader)
    require_value(read_u8(reader, "payload_version") == VERSION,
        "payload version unsupported")
    return {
        call_generation = read_u32_le(reader, "call_generation"),
        fencing_token = read_u64_safe(reader, "fencing_token"),
        communication_session_id = read_identifier(reader, 160,
            "communication_session_id"),
        provider_call_id = read_identifier(reader, 200, "provider_call_id"),
        device_id = read_identifier(reader, 128, "device_id"),
        lease_id = read_identifier(reader, 128, "lease_id"),
    }
end
local function encode_context(input)
    return encode_binding(input)
        .. encode_identifier(input.provider_operation_id, 200,
            "provider_operation_id")
        .. encode_identifier(input.command_id, 128, "command_id")
        .. encode_identifier(input.idempotency_key, 200, "idempotency_key")
end
local function decode_context(reader)
    local output = decode_binding(reader)
    output.provider_operation_id = read_identifier(reader, 200,
        "provider_operation_id")
    output.command_id = read_identifier(reader, 128, "command_id")
    output.idempotency_key = read_identifier(reader, 200, "idempotency_key")
    return output
end
local function validate_heartbeat_pair(state, binding)
    require_value(DEVICE_STATE[state], "device state unsupported")
    require_value(not (state == "ready" and binding) and
        not (state == "in_call" and not binding),
        "heartbeat state and binding mismatch")
end
local function valid_e164(value)
    return type(value) == "string" and #value >= 9 and #value <= 16
        and value:match("^%+[1-9]%d+$")
end
local function valid_dtmf(value)
    return type(value) == "string" and #value >= 1 and #value <= 64
        and value:match("^[0-9%*#A-D]+$")
end
function M.encode_hello(input)
    return protect(function(value)
        require_value(value.protocol_version == VERSION, "protocol version unsupported")
        require_value(is_uint(value.capability_flags, 15), "capability flags unsupported")
        require_value(is_uint(value.max_payload_bytes, 0xFFFF) and
            value.max_payload_bytes >= MIN_AUDIO_PAYLOAD_BYTES,
            "max payload bytes cannot carry audio")
        return string.char(VERSION)
            .. encode_identifier(value.device_id, 128, "device_id")
            .. encode_identifier(value.boot_id, 128, "boot_id")
            .. encode_identifier(value.firmware_version, 64, "firmware_version")
            .. string.char(value.protocol_version)
            .. encode_u16_le(value.capability_flags)
            .. encode_u16_le(value.max_payload_bytes)
    end, input)
end
function M.decode_hello(payload)
    return protect(function(value)
        local reader = new_reader(value)
        require_value(read_u8(reader, "payload_version") == VERSION,
            "payload version unsupported")
        local output = {
            device_id = read_identifier(reader, 128, "device_id"),
            boot_id = read_identifier(reader, 128, "boot_id"),
            firmware_version = read_identifier(reader, 64, "firmware_version"),
            protocol_version = read_u8(reader, "protocol_version"),
            capability_flags = read_u16_le(reader, "capability_flags"),
            max_payload_bytes = read_u16_le(reader, "max_payload_bytes"),
        }
        assert_end(reader)
        local encoded, message = M.encode_hello(output)
        require_value(encoded, message)
        return output
    end, payload)
end
function M.encode_heartbeat(input)
    return protect(function(value)
        validate_heartbeat_pair(value.device_state, value.active_binding)
        require_value(is_uint(value.heartbeat_sequence, 0xFFFFFFFF),
            "heartbeat_sequence must be uint32")
        local output = string.char(VERSION)
            .. encode_identifier(value.device_id, 128, "device_id")
            .. encode_identifier(value.boot_id, 128, "boot_id")
            .. encode_u32_le(value.heartbeat_sequence)
            .. encode_u64_decimal_le(value.uptime_ms, false)
            .. string.char(DEVICE_STATE[value.device_state])
            .. string.char(value.active_binding and 1 or 0)
        if value.active_binding then output = output .. encode_binding(value.active_binding) end
        return output
    end, input)
end
function M.decode_heartbeat(payload)
    return protect(function(value)
        local reader = new_reader(value)
        require_value(read_u8(reader, "payload_version") == VERSION,
            "payload version unsupported")
        local output = {
            device_id = read_identifier(reader, 128, "device_id"),
            boot_id = read_identifier(reader, 128, "boot_id"),
            heartbeat_sequence = read_u32_le(reader, "heartbeat_sequence"),
            uptime_ms = read_u64_decimal(reader, "uptime_ms"),
            device_state = STATE_CODE[read_u8(reader, "device_state")],
        }
        local present = read_u8(reader, "active_binding_present")
        require_value(present == 0 or present == 1, "heartbeat binding marker invalid")
        if present == 1 then output.active_binding = decode_binding(reader) end
        assert_end(reader)
        validate_heartbeat_pair(output.device_state, output.active_binding)
        return output
    end, payload)
end
function M.encode_command(input)
    return protect(function(value)
        require_value(COMMAND_TYPE[value.type], "command type unsupported")
        local output = encode_context(value)
        if value.type == "dial" then
            require_value(valid_e164(value.dial_target_e164), "E.164 invalid")
            output = output .. string.char(#value.dial_target_e164)
                .. value.dial_target_e164
        elseif value.type == "dtmf" then
            require_value(valid_dtmf(value.digits), "DTMF invalid")
            output = output .. string.char(#value.digits) .. value.digits
        end
        return output
    end, input)
end
function M.decode_command(frame_type, payload)
    return protect(function(type_code, value)
        local command = TYPE_COMMAND[type_code]
        require_value(command, "command type unsupported")
        local reader = new_reader(value)
        local output = decode_context(reader)
        output.type = command
        if command == "dial" then
            local length = read_u8(reader, "dial_target_e164_length")
            output.dial_target_e164 = read_bytes(reader, length, "dial_target_e164")
            require_value(valid_e164(output.dial_target_e164), "E.164 invalid")
        elseif command == "dtmf" then
            local length = read_u8(reader, "digits_length")
            output.digits = read_bytes(reader, length, "digits")
            require_value(valid_dtmf(output.digits), "DTMF invalid")
        end
        assert_end(reader)
        return output
    end, frame_type, payload)
end
local function encode_result(input, code)
    require_value(COMMAND_TYPE[input.command_type], "command type unsupported")
    return encode_context(input) .. encode_u32_le(input.request_frame_sequence)
        .. string.char(COMMAND_TYPE[input.command_type], code)
end
local function decode_result(payload, codes, name)
    local reader = new_reader(payload)
    local output = decode_context(reader)
    output.request_frame_sequence = read_u32_le(reader, "request_frame_sequence")
    output.command_type = TYPE_COMMAND[read_u8(reader, "command_type")]
    output[name] = codes[read_u8(reader, name)]
    require_value(output.command_type and output[name], name .. " unsupported")
    assert_end(reader)
    return output
end
function M.encode_ack(input)
    return protect(function(value)
        require_value(value.result == "applied", "ACK result unsupported")
        return encode_result(value, 1)
    end, input)
end
function M.decode_ack(payload)
    return protect(function(value)
        return decode_result(value, { [1] = "applied" }, "result")
    end, payload)
end
function M.encode_error(input)
    return protect(function(value)
        require_value(ERROR_CODE[value.error_code], "error code unsupported")
        return encode_result(value, ERROR_CODE[value.error_code])
    end, input)
end
function M.decode_error(payload)
    return protect(function(value)
        return decode_result(value, CODE_ERROR, "error_code")
    end, payload)
end
return M
