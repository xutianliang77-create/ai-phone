local frame_codec = require("vuart_v1_codec")
local command_codec = require("vuart_v1_cmd_codec")
local stream = require("vuart_v1_stream")
local ledger_module = require("vuart_v1_ledger")

local M = {}
local FRAME = { hello = 1, heartbeat = 2, dial = 3, hangup = 4,
    dtmf = 5, call_state = 6, audio_downlink = 16, audio_uplink = 17,
    ack = 32, error = 33, link_ack = 34 }
local TERMINAL_STATE = { disconnected = true, busy = true, failed = true }
local COMMAND_ERROR = { unsupported_command = true, stale_fence = true,
    binding_mismatch = true, stale_generation = true,
    idempotency_conflict = true, invalid_state = true,
    invalid_argument = true, internal_error = true }

local function require_value(condition, message)
    if not condition then error("vuart_v1_runtime: " .. message, 0) end
end

local function copy_binding(value)
    return {
        communication_session_id = value.communication_session_id,
        provider_call_id = value.provider_call_id,
        device_id = value.device_id,
        lease_id = value.lease_id,
        fencing_token = value.fencing_token,
        call_generation = value.call_generation,
    }
end

local function same_binding(left, right)
    return left and right
        and left.communication_session_id == right.communication_session_id
        and left.provider_call_id == right.provider_call_id
        and left.device_id == right.device_id
        and left.lease_id == right.lease_id
        and left.fencing_token == right.fencing_token
        and left.call_generation == right.call_generation
end

local function result_input(command, request_sequence)
    local output = {}
    for key, value in pairs(command) do output[key] = value end
    output.request_frame_sequence = request_sequence
    output.command_type = command.type
    return output
end

function M.new(options)
    require_value(type(options) == "table", "options required")
    require_value(type(options.device_id) == "string", "device_id required")
    require_value(type(options.boot_id) == "string", "boot_id required")
    require_value(type(options.firmware_version) == "string",
        "firmware_version required")
    require_value(type(options.write) == "function", "write callback required")
    require_value(type(options.now_ms) == "function", "now_ms callback required")
    require_value(type(options.uptime_ms) == "function", "uptime_ms callback required")
    require_value(type(options.carrier) == "table", "carrier adapter required")

    local state = {
        device_id = options.device_id,
        boot_id = options.boot_id,
        firmware_version = options.firmware_version,
        capability_flags = options.capability_flags or 3,
        max_payload_bytes = options.max_payload_bytes or 6461,
        write = options.write,
        now_ms = options.now_ms,
        uptime_ms = options.uptime_ms,
        carrier = options.carrier,
        parser = stream.new({ max_payload_bytes = options.max_payload_bytes or 6461 }),
        ledger = ledger_module.new({ max_records = options.max_records or 128 }),
        next_sequence = options.initial_sequence or 0,
        heartbeat_sequence = 0,
        event_sequence = 0,
        downlink_media_sequence = 0,
        uplink_media_sequence = nil,
        device_state = "ready",
        active_binding = nil,
        last_binding = nil,
        hangup_pending = false,
        last_sent_link_sequences = {},
        last_acked_link_sequences = {},
        counters = {
            commands_received = 0, commands_applied = 0, response_replays = 0,
            idempotency_conflicts = 0, stale_fences = 0, stale_generations = 0,
            binding_mismatches = 0, invalid_commands = 0,
            ledger_capacity_rejections = 0, carrier_errors = 0,
            write_rejections = 0, audio_downlink_frames = 0,
            audio_downlink_drops = 0, audio_without_binding = 0,
            audio_uplink_frames = 0, audio_uplink_drops = 0,
            audio_uplink_duplicates = 0, audio_uplink_out_of_order = 0,
            audio_uplink_gap_events = 0, audio_uplink_missing_chunks = 0,
            audio_uplink_binding_mismatches = 0,
            audio_uplink_without_binding = 0,
            link_acks_received = 0, link_ack_duplicates = 0,
            link_ack_out_of_order = 0, link_ack_invalid = 0,
        },
    }

    local function allocate_sequence(self)
        local value = self.next_sequence
        self.next_sequence = (self.next_sequence + 1) % 4294967296
        return value
    end

    local function encode_output(self, frame_type, payload)
        local sequence = allocate_sequence(self)
        local encoded, message = frame_codec.encode_frame({
            type = frame_type,
            flags = 0,
            sequence = sequence,
            timestamp_ms = self.now_ms(),
            payload = payload,
        })
        require_value(encoded, message or "frame encoding failed")
        return encoded, sequence
    end

    local function emit_encoded(self, encoded)
        local accepted = self.write(encoded)
        if accepted == false then
            self.counters.write_rejections = self.counters.write_rejections + 1
            return false
        end
        return true
    end

    local function send_payload(self, frame_type, payload)
        local encoded, sequence = encode_output(self, frame_type, payload)
        emit_encoded(self, encoded)
        return encoded, sequence
    end

    local function send_error(self, command, request_sequence, error_code)
        local input = result_input(command, request_sequence)
        input.error_code = error_code
        local payload, message = command_codec.encode_error(input)
        require_value(payload, message or "ERROR encoding failed")
        return send_payload(self, FRAME.error, payload)
    end

    local function binding_error(self, command)
        if command.device_id ~= self.device_id then return "binding_mismatch" end
        local current = self.active_binding or self.last_binding
        if not current then return nil end
        if command.fencing_token < current.fencing_token then return "stale_fence" end
        if command.call_generation < current.call_generation then
            return "stale_generation"
        end
        if self.active_binding then
            if not same_binding(command, self.active_binding) then
                return "binding_mismatch"
            end
            return nil
        end
        if same_binding(command, current) then return nil end
        if command.call_generation <= current.call_generation then
            return "binding_mismatch"
        end
        if command.lease_id ~= current.lease_id
            and command.fencing_token <= current.fencing_token then
            return "stale_fence"
        end
        return nil
    end

    local function record_binding_error(self, error_code)
        if error_code == "stale_fence" then
            self.counters.stale_fences = self.counters.stale_fences + 1
        elseif error_code == "stale_generation" then
            self.counters.stale_generations = self.counters.stale_generations + 1
        else
            self.counters.binding_mismatches = self.counters.binding_mismatches + 1
        end
    end

    local function apply_effect(self, command)
        if command.type == "dial" then
            if self.device_state ~= "ready" or self.active_binding then
                return { status = "rejected", error_code = "invalid_state" }
            end
            if self.last_binding and same_binding(command, self.last_binding) then
                return { status = "rejected", error_code = "invalid_state" }
            end
        elseif command.type == "hangup" then
            if self.device_state ~= "in_call" or not self.active_binding
                or self.hangup_pending then
                return { status = "rejected", error_code = "invalid_state" }
            end
        elseif command.type == "dtmf" then
            if math.floor(self.capability_flags / 8) % 2 == 0 then
                return { status = "rejected", error_code = "unsupported_command" }
            end
            if self.device_state ~= "in_call" or not self.active_binding
                or type(self.carrier.is_connected) ~= "function"
                or not self.carrier.is_connected() then
                return { status = "rejected", error_code = "invalid_state" }
            end
        end
        local operation = self.carrier[command.type]
        if type(operation) ~= "function" then
            return { status = "rejected", error_code = "unsupported_command" }
        end
        local called, result = pcall(operation, command)
        if not called or type(result) ~= "table" then
            self.counters.carrier_errors = self.counters.carrier_errors + 1
            return { status = "rejected", error_code = "internal_error" }
        end
        if result.status ~= "applied" then
            local error_code = result.error_code
            if not COMMAND_ERROR[error_code] then
                self.counters.carrier_errors = self.counters.carrier_errors + 1
                error_code = "internal_error"
            end
            return { status = "rejected", error_code = error_code }
        end
        if command.type == "dial" then
            self.active_binding = copy_binding(command)
            self.last_binding = copy_binding(command)
            self.device_state = "in_call"
            self.hangup_pending = false
            self.downlink_media_sequence = 0
            self.uplink_media_sequence = nil
        elseif command.type == "hangup" then
            self.hangup_pending = true
        end
        return { status = "applied" }
    end

    local function handle_command(self, frame)
        self.counters.commands_received = self.counters.commands_received + 1
        if frame.flags ~= 0 then
            self.counters.invalid_commands = self.counters.invalid_commands + 1
            return
        end
        local command = command_codec.decode_command(frame.type, frame.payload)
        if not command then
            self.counters.invalid_commands = self.counters.invalid_commands + 1
            return
        end
        local error_code = binding_error(self, command)
        if error_code then
            record_binding_error(self, error_code)
            send_error(self, command, frame.sequence, error_code)
            return
        end

        local signature = ledger_module.signature(frame.type, frame.payload)
        local status, cached = self.ledger:lookup(command.command_id,
            command.idempotency_key, signature)
        if status == "replay" then
            self.counters.response_replays = self.counters.response_replays + 1
            emit_encoded(self, cached)
            return
        elseif status == "conflict" then
            self.counters.idempotency_conflicts =
                self.counters.idempotency_conflicts + 1
            send_error(self, command, frame.sequence, "idempotency_conflict")
            return
        elseif status == "full" then
            self.counters.ledger_capacity_rejections =
                self.counters.ledger_capacity_rejections + 1
            send_error(self, command, frame.sequence, "internal_error")
            return
        end

        local result = apply_effect(self, command)
        local input = result_input(command, frame.sequence)
        local payload, message, response_type
        if result.status == "applied" then
            input.result = "applied"
            payload, message = command_codec.encode_ack(input)
            response_type = FRAME.ack
            self.counters.commands_applied = self.counters.commands_applied + 1
        else
            input.error_code = result.error_code
            payload, message = command_codec.encode_error(input)
            response_type = FRAME.error
        end
        require_value(payload, message or "command result encoding failed")
        local reply = encode_output(self, response_type, payload)
        self.ledger:store(command.command_id, command.idempotency_key,
            signature, reply)
        emit_encoded(self, reply)
    end

    local function handle_audio_uplink(self, frame)
        if not self.active_binding then
            self.counters.audio_uplink_without_binding =
                self.counters.audio_uplink_without_binding + 1
            self.counters.audio_uplink_drops =
                self.counters.audio_uplink_drops + 1
            return
        end
        if frame.flags ~= 0 or math.floor(self.capability_flags / 4) % 2 == 0 then
            self.counters.audio_uplink_drops =
                self.counters.audio_uplink_drops + 1
            return
        end
        local audio = frame_codec.decode_audio(frame.payload)
        if not audio then
            self.counters.audio_uplink_drops =
                self.counters.audio_uplink_drops + 1
            return
        end
        if not same_binding(audio, self.active_binding) then
            self.counters.audio_uplink_binding_mismatches =
                self.counters.audio_uplink_binding_mismatches + 1
            self.counters.audio_uplink_drops =
                self.counters.audio_uplink_drops + 1
            return
        end
        local sequence = audio.media_sequence
        if sequence == self.uplink_media_sequence then
            self.counters.audio_uplink_duplicates =
                self.counters.audio_uplink_duplicates + 1
            self.counters.audio_uplink_drops =
                self.counters.audio_uplink_drops + 1
            return
        end
        if self.uplink_media_sequence and sequence < self.uplink_media_sequence then
            self.counters.audio_uplink_out_of_order =
                self.counters.audio_uplink_out_of_order + 1
            self.counters.audio_uplink_drops =
                self.counters.audio_uplink_drops + 1
            return
        end
        if self.uplink_media_sequence and sequence > self.uplink_media_sequence + 1 then
            self.counters.audio_uplink_gap_events =
                self.counters.audio_uplink_gap_events + 1
            self.counters.audio_uplink_missing_chunks =
                self.counters.audio_uplink_missing_chunks
                + sequence - self.uplink_media_sequence - 1
        end
        self.uplink_media_sequence = sequence
        local operation = self.carrier.audio_uplink
        local called, accepted = false, false
        if type(operation) == "function" then
            called, accepted = pcall(operation, audio.pcm, sequence,
                audio.call_generation)
        end
        if called and accepted == true then
            self.counters.audio_uplink_frames =
                self.counters.audio_uplink_frames + 1
        else
            self.counters.audio_uplink_drops =
                self.counters.audio_uplink_drops + 1
        end
    end

    local function handle_link_ack(self, frame)
        if frame.flags ~= 0 then
            self.counters.link_ack_invalid = self.counters.link_ack_invalid + 1
            return
        end
        local acknowledgement = frame_codec.decode_link_ack(frame.payload)
        if not acknowledgement then
            self.counters.link_ack_invalid = self.counters.link_ack_invalid + 1
            return
        end
        local frame_type = acknowledgement.acknowledged_type
        local sent = self.last_sent_link_sequences[frame_type]
        local previous = self.last_acked_link_sequences[frame_type]
        local sequence = acknowledgement.acknowledged_sequence
        if sent == nil or sequence > sent then
            self.counters.link_ack_invalid = self.counters.link_ack_invalid + 1
            return
        end
        if previous ~= nil and sequence <= previous then
            if sequence == previous then
                self.counters.link_ack_duplicates =
                    self.counters.link_ack_duplicates + 1
            else
                self.counters.link_ack_out_of_order =
                    self.counters.link_ack_out_of_order + 1
            end
            return
        end
        self.last_acked_link_sequences[frame_type] = sequence
        self.counters.link_acks_received = self.counters.link_acks_received + 1
    end

    local function send_hello(self)
        local payload, message = command_codec.encode_hello({
            device_id = self.device_id,
            boot_id = self.boot_id,
            firmware_version = self.firmware_version,
            protocol_version = 1,
            capability_flags = self.capability_flags,
            max_payload_bytes = self.max_payload_bytes,
        })
        require_value(payload, message or "HELLO encoding failed")
        local encoded, sequence = send_payload(self, FRAME.hello, payload)
        self.last_sent_link_sequences[FRAME.hello] = sequence
        return encoded
    end

    local function send_heartbeat(self)
        local payload, message = command_codec.encode_heartbeat({
            device_id = self.device_id,
            boot_id = self.boot_id,
            heartbeat_sequence = self.heartbeat_sequence,
            uptime_ms = self.uptime_ms(),
            device_state = self.device_state,
            active_binding = self.active_binding,
        })
        require_value(payload, message or "HEARTBEAT encoding failed")
        self.heartbeat_sequence = (self.heartbeat_sequence + 1) % 4294967296
        local encoded, sequence = send_payload(self, FRAME.heartbeat, payload)
        self.last_sent_link_sequences[FRAME.heartbeat] = sequence
        return encoded
    end

    function state:start()
        send_hello(self)
        return send_heartbeat(self)
    end

    function state:heartbeat()
        send_hello(self)
        return send_heartbeat(self)
    end

    function state:ingest(chunk)
        for _, frame in ipairs(self.parser:feed(chunk)) do
            if frame.type == FRAME.dial or frame.type == FRAME.hangup
                or frame.type == FRAME.dtmf then
                handle_command(self, frame)
            elseif frame.type == FRAME.audio_uplink then
                handle_audio_uplink(self, frame)
            elseif frame.type == FRAME.link_ack then
                handle_link_ack(self, frame)
            end
        end
    end

    function state:carrier_event(carrier_state, carrier_cause)
        require_value(self.active_binding, "carrier event without active binding")
        local input = copy_binding(self.active_binding)
        input.event_sequence = self.event_sequence
        input.carrier_state = carrier_state
        input.carrier_cause = carrier_cause
        local payload, message = frame_codec.encode_call_state(input)
        require_value(payload, message or "CALL_STATE encoding failed")
        self.event_sequence = (self.event_sequence + 1) % 4294967296
        local reply = send_payload(self, FRAME.call_state, payload)
        if TERMINAL_STATE[carrier_state] then
            if type(self.carrier.stop_uplink) == "function" then
                local called, accepted = pcall(self.carrier.stop_uplink,
                    self.active_binding.call_generation)
                if not called or accepted ~= true then
                    self.counters.carrier_errors = self.counters.carrier_errors + 1
                end
            end
            self.active_binding = nil
            self.device_state = "ready"
            self.hangup_pending = false
            self.downlink_media_sequence = 0
            self.uplink_media_sequence = nil
        end
        return reply
    end

    function state:audio_downlink(pcm)
        if not self.active_binding then
            self.counters.audio_without_binding =
                self.counters.audio_without_binding + 1
            return false, "no_active_binding"
        end
        local input = copy_binding(self.active_binding)
        input.media_sequence = self.downlink_media_sequence
        input.pcm = pcm
        local payload, message = frame_codec.encode_audio(input)
        if not payload then
            self.counters.audio_downlink_drops =
                self.counters.audio_downlink_drops + 1
            return false, message or "audio encoding failed"
        end
        self.downlink_media_sequence =
            (self.downlink_media_sequence + 1) % 4294967296
        self.counters.audio_downlink_frames =
            self.counters.audio_downlink_frames + 1
        local encoded = encode_output(self, FRAME.audio_downlink, payload)
        if not emit_encoded(self, encoded) then
            self.counters.audio_downlink_drops =
                self.counters.audio_downlink_drops + 1
            return false, "transport_backpressure"
        end
        return true
    end

    function state:quarantine()
        self.device_state = "quarantined"
    end

    function state:resume()
        self.device_state = self.active_binding and "in_call" or "ready"
    end

    function state:metrics()
        local output = {}
        for key, value in pairs(self.counters) do output[key] = value end
        output.device_state = self.device_state
        output.boot_id = self.boot_id
        output.ledger_records = self.ledger:metrics().records
        output.stream = self.parser:metrics()
        return output
    end

    return state
end

return M
