local M = {}

local function require_value(condition, message)
    if not condition then error("vuart_v1_cc: " .. message, 0) end
end

local function is_uint32(value)
    return type(value) == "number" and value > 0 and value <= 0xffffffff
        and value == math.floor(value)
end

local EVENT_COUNTER = {
    READY = "ready_events", MAKE_CALL_OK = "make_call_ok_events",
    CONNECTED = "connected_events", SPEECH_START = "speech_start_events",
    AUDIO_START = "audio_start_events", EXT_SRC_DONE = "ext_src_done_events",
    DISCONNECTED = "disconnected_events",
    HANGUP_CALL_DONE = "hangup_done_events",
}

function M.new(options)
    require_value(type(options) == "table", "options required")
    require_value(type(options.cc_api) == "table", "cc_api required")
    require_value(type(options.subscribe) == "function", "subscribe required")

    local state = {
        cc_api = options.cc_api,
        now_ms = options.now_ms or function() return 0 end,
        sim_id = options.sim_id or 0,
        zbuff_api = options.zbuff_api,
        uplink = options.uplink,
        enable_downlink = options.enable_downlink == true,
        buffer_size = options.buffer_size or 6400,
        telephony_ready = false,
        audio_ready = false,
        cc_initialized = false,
        record_configured = false,
        record_active = false,
        ready = false,
        call_state = "idle",
        call_generation = 0,
        audio_quality = 0,
        media_started = false,
        hangup_pending = false,
        source_failure_pending = false,
        memory_failed = false,
        terminal_emitted = false,
        last_event = nil,
        last_raw_event = "none",
        last_raw_event_ms = 0,
        record_started_ms = 0,
        media_started_ms = 0,
        event_handler = options.on_event,
        downlink_handler = options.on_downlink,
        ready_handler = options.on_ready,
        buffers = nil,
        counters = {
            init_attempts = 0, init_failures = 0, record_failures = 0,
            carrier_events = 0, ignored_events = 0, handler_errors = 0,
            dial_calls = 0, hangup_calls = 0, downlink_frames = 0,
            downlink_drops = 0, uplink_discarded = 0,
            uplink_frames = 0, uplink_drops = 0, quality_failures = 0,
            source_failure_hangups = 0, source_failure_hangup_failures = 0,
            source_failure_unknown_events = 0,
            memory_failures = 0,
            ready_events = 0, make_call_ok_events = 0,
            connected_events = 0, speech_start_events = 0,
            audio_start_events = 0, ext_src_done_events = 0,
            disconnected_events = 0, hangup_done_events = 0,
            record_start_attempts = 0, record_starts = 0,
            record_stops = 0, record_callbacks = 0,
        },
    }

    local function emit(self, carrier_state, carrier_cause)
        local signature = carrier_state .. ":" .. carrier_cause
        if self.last_event == signature then return end
        self.last_event = signature
        if type(self.event_handler) ~= "function" then return end
        local called = pcall(self.event_handler, carrier_state, carrier_cause)
        if not called then
            self.counters.handler_errors = self.counters.handler_errors + 1
        end
    end

    local function clear_buffer(buffer)
        if not buffer then return end
        pcall(buffer.used, buffer, 0)
        pcall(buffer.seek, buffer, 0)
    end

    local function record_callback(self, is_downlink, point)
        self.counters.record_callbacks = self.counters.record_callbacks + 1
        local group = is_downlink and self.buffers.down or self.buffers.up
        local buffer = point == 1 and group[1] or point == 2 and group[2] or nil
        if not buffer then
            self.counters.downlink_drops = self.counters.downlink_drops + 1
            return
        end
        local used_ok, used = pcall(buffer.used, buffer)
        if not used_ok or type(used) ~= "number" then
            self.counters.downlink_drops = self.counters.downlink_drops + 1
            clear_buffer(buffer)
            return
        end
        if not is_downlink then
            self.counters.uplink_discarded =
                self.counters.uplink_discarded + 1
            clear_buffer(buffer)
            return
        end
        if used ~= self.buffer_size then
            self.counters.downlink_drops = self.counters.downlink_drops + 1
            clear_buffer(buffer)
            return
        end
        local query_ok, pcm = pcall(buffer.query, buffer)
        clear_buffer(buffer)
        if not query_ok or type(pcm) ~= "string" or #pcm ~= self.buffer_size then
            self.counters.downlink_drops = self.counters.downlink_drops + 1
            return
        end
        local delivered = false
        if type(self.downlink_handler) == "function" then
            local called, result = pcall(self.downlink_handler, pcm)
            delivered = called and result ~= false
            if not called then
                self.counters.handler_errors = self.counters.handler_errors + 1
            end
        end
        if delivered then
            self.counters.downlink_frames = self.counters.downlink_frames + 1
        else
            self.counters.downlink_drops = self.counters.downlink_drops + 1
        end
    end

    local function configure_record(self)
        if not self.enable_downlink then return true end
        if self.record_configured then return true end
        if type(self.zbuff_api) ~= "table"
            or type(self.zbuff_api.create) ~= "function"
            or type(self.cc_api.on) ~= "function"
            or type(self.cc_api.record) ~= "function" then
            self.counters.record_failures = self.counters.record_failures + 1
            return false
        end
        local created, buffers = pcall(function()
            return {
                up = {
                    self.zbuff_api.create(self.buffer_size, 0,
                        self.zbuff_api.HEAP_AUTO),
                    self.zbuff_api.create(self.buffer_size, 0,
                        self.zbuff_api.HEAP_AUTO),
                },
                down = {
                    self.zbuff_api.create(self.buffer_size, 0,
                        self.zbuff_api.HEAP_AUTO),
                    self.zbuff_api.create(self.buffer_size, 0,
                        self.zbuff_api.HEAP_AUTO),
                },
            }
        end)
        if not created then
            self.counters.record_failures = self.counters.record_failures + 1
            return false
        end
        self.buffers = buffers
        local registered = pcall(self.cc_api.on, "record",
            function(is_downlink, point)
                record_callback(self, is_downlink, point)
            end)
        if not registered then
            self.counters.record_failures = self.counters.record_failures + 1
            return false
        end
        self.record_configured = true
        return true
    end

    local function start_record(self)
        if not self.enable_downlink then return true end
        if self.record_active then return true end
        if not self.record_configured or not self.buffers then return false end
        self.counters.record_start_attempts =
            self.counters.record_start_attempts + 1
        local called, result = pcall(self.cc_api.record, true,
            self.buffers.up[1], self.buffers.up[2],
            self.buffers.down[1], self.buffers.down[2])
        if not called or result ~= true then
            self.counters.record_failures = self.counters.record_failures + 1
            return false
        end
        self.record_active = true
        self.record_started_ms = self.now_ms()
        self.counters.record_starts = self.counters.record_starts + 1
        return true
    end

    local function stop_record(self)
        if not self.record_active then return end
        pcall(self.cc_api.record, false)
        self.record_active = false
        self.counters.record_stops = self.counters.record_stops + 1
    end

    local function notify_ready(self)
        if self.ready then return end
        self.ready = true
        if type(self.ready_handler) == "function" then
            local called = pcall(self.ready_handler)
            if not called then
                self.counters.handler_errors = self.counters.handler_errors + 1
            end
        end
    end

    local function maybe_initialize(self)
        if not self.telephony_ready or not self.audio_ready then return end
        if not self.cc_initialized then
            self.counters.init_attempts = self.counters.init_attempts + 1
            local called, result = pcall(self.cc_api.init, self.sim_id)
            if not called or result ~= true then
                self.counters.init_failures = self.counters.init_failures + 1
                return
            end
            self.cc_initialized = true
        end
        if configure_record(self) then notify_ready(self) end
    end

    local function terminal(self, carrier_state, carrier_cause)
        if self.call_state == "idle" or self.terminal_emitted then return end
        stop_record(self)
        if self.source_failure_pending then
            carrier_state = "failed"
            carrier_cause = "device_error"
        end
        self.terminal_emitted = true
        emit(self, carrier_state, carrier_cause)
        self.call_state = "idle"
        self.call_generation = 0
        self.audio_quality = 0
        self.media_started = false
        self.hangup_pending = false
        self.source_failure_pending = false
    end

    local function fail_closed_on_source_failure(self)
        if self.call_state ~= "connected" or self.hangup_pending then
            return false
        end
        self.source_failure_pending = true
        -- Block any second source-failure action even if the carrier API
        -- explicitly rejects the hangup. In that case report a non-terminal
        -- unknown state so the host quarantines media and reconciles; do not
        -- invent a carrier terminal while the physical call may remain up.
        self.hangup_pending = true
        local called, accepted = pcall(self.cc_api.hangUp, self.sim_id)
        if not called or accepted == false then
            self.counters.source_failure_hangup_failures =
                self.counters.source_failure_hangup_failures + 1
            self.counters.source_failure_unknown_events =
                self.counters.source_failure_unknown_events + 1
            emit(self, "unknown", "unknown")
            return false
        end
        self.counters.hangup_calls = self.counters.hangup_calls + 1
        self.counters.source_failure_hangups =
            self.counters.source_failure_hangups + 1
        return true
    end

    local function carrier_event(self, status)
        self.counters.carrier_events = self.counters.carrier_events + 1
        self.last_raw_event = status
        self.last_raw_event_ms = self.now_ms()
        local event_counter = EVENT_COUNTER[status]
        if event_counter then
            self.counters[event_counter] = self.counters[event_counter] + 1
        end
        if status == "READY" then
            self.telephony_ready = true
            maybe_initialize(self)
        elseif status == "MAKE_CALL_OK" and self.call_state == "dialing" then
            emit(self, "dialing", "none")
        elseif (status == "CONNECTED" or status == "SPEECH_START")
            and self.call_state ~= "idle" then
            self.call_state = "connected"
        elseif status == "AUDIO_START" and self.call_state ~= "idle" then
            self.call_state = "connected"
            if self.media_started then return end
            local called, quality = pcall(self.cc_api.quality)
            if not called or (quality ~= 1 and quality ~= 2) then
                self.audio_quality = 0
                self.counters.quality_failures =
                    self.counters.quality_failures + 1
                fail_closed_on_source_failure(self)
                return
            end
            self.audio_quality = quality
            if not start_record(self) then
                self.audio_quality = 0
                fail_closed_on_source_failure(self)
                return
            end
            if type(self.uplink) ~= "table"
                or not self.uplink:begin_call(self.call_generation, quality) then
                self.audio_quality = 0
                stop_record(self)
                fail_closed_on_source_failure(self)
                return
            end
            self.media_started = true
            self.media_started_ms = self.now_ms()
            emit(self, "connected", "none")
        elseif status == "EXT_SRC_DONE" and self.uplink then
            local metrics = self.uplink:metrics()
            local handled = self.uplink:on_done(metrics.generation)
            if handled ~= true and metrics.call_active then
                fail_closed_on_source_failure(self)
            end
        elseif status == "MAKE_CALL_FAILED" and self.call_state ~= "idle" then
            terminal(self, "failed", "network_error")
        elseif status == "DISCONNECTED" or status == "HANGUP_CALL_DONE" then
            terminal(self, "disconnected",
                self.hangup_pending and "local_hangup" or "remote_hangup")
        else
            self.counters.ignored_events = self.counters.ignored_events + 1
        end
    end

    local subscribed = pcall(options.subscribe, "CC_IND",
        function(status) carrier_event(state, status) end)
    require_value(subscribed, "CC_IND subscribe failed")

    function state:set_audio_ready(value)
        self.audio_ready = value == true
        maybe_initialize(self)
    end

    function state:set_event_handler(handler)
        self.event_handler = handler
    end

    function state:set_downlink_handler(handler)
        self.downlink_handler = handler
    end

    function state:set_ready_handler(handler)
        self.ready_handler = handler
        if self.ready and type(handler) == "function" then pcall(handler) end
    end

    function state.dial(command)
        if not state.ready or state.call_state ~= "idle" then
            return { status = "rejected", error_code = "invalid_state" }
        end
        if type(command) ~= "table"
            or not is_uint32(command.call_generation) then
            return { status = "rejected", error_code = "invalid_state" }
        end
        local called, result = pcall(state.cc_api.dial, state.sim_id,
            command.dial_target_e164)
        if not called or result ~= true then
            return { status = "rejected", error_code = "internal_error" }
        end
        state.counters.dial_calls = state.counters.dial_calls + 1
        state.call_state = "dialing"
        state.call_generation = command.call_generation
        state.audio_quality = 0
        state.media_started = false
        state.record_started_ms = 0
        state.media_started_ms = 0
        state.hangup_pending = false
        state.source_failure_pending = false
        state.terminal_emitted = false
        state.last_event = nil
        return { status = "applied" }
    end

    function state.hangup(_command)
        if not state.ready or state.call_state == "idle"
            or state.hangup_pending then
            return { status = "rejected", error_code = "invalid_state" }
        end
        local called, accepted = pcall(state.cc_api.hangUp, state.sim_id)
        if not called or accepted == false then
            return { status = "rejected", error_code = "internal_error" }
        end
        state.counters.hangup_calls = state.counters.hangup_calls + 1
        state.hangup_pending = true
        return { status = "applied" }
    end

    function state.dtmf(_command)
        return { status = "rejected", error_code = "unsupported_command" }
    end

    function state.audio_uplink(pcm, media_sequence, generation)
        if not state.ready or state.call_state ~= "connected"
            or state.hangup_pending or state.audio_quality == 0
            or type(state.uplink) ~= "table"
            or generation ~= state.call_generation then
            state.counters.uplink_drops = state.counters.uplink_drops + 1
            return false
        end
        local metrics = state.uplink:metrics()
        if not metrics.call_active or metrics.generation ~= generation then
            state.counters.uplink_drops = state.counters.uplink_drops + 1
            fail_closed_on_source_failure(state)
            return false
        end
        local accepted = state.uplink:enqueue(generation, media_sequence, pcm)
        if accepted then
            state.counters.uplink_frames = state.counters.uplink_frames + 1
        else
            state.counters.uplink_drops = state.counters.uplink_drops + 1
            local after = state.uplink:metrics()
            if after.call_active and after.faulted then
                fail_closed_on_source_failure(state)
            end
        end
        return accepted == true
    end

    function state.stop_uplink(generation)
        if type(state.uplink) ~= "table" then return true end
        local metrics = state.uplink:metrics()
        if not metrics.call_active then return true end
        return state.uplink:stop(generation)
    end

    function state:fail_closed(_reason)
        if self.memory_failed then return true end
        self.memory_failed = true
        self.ready = false
        self.counters.memory_failures = self.counters.memory_failures + 1
        stop_record(self)
        if type(self.uplink) == "table" then
            local metrics = self.uplink:metrics()
            if metrics.call_active then pcall(self.uplink.stop, self.uplink, metrics.generation) end
        end
        if self.call_state == "idle" or self.hangup_pending then return true end

        self.source_failure_pending = true
        self.hangup_pending = true
        local called, accepted = pcall(self.cc_api.hangUp, self.sim_id)
        if not called or accepted == false then
            self.counters.source_failure_hangup_failures =
                self.counters.source_failure_hangup_failures + 1
            self.counters.source_failure_unknown_events =
                self.counters.source_failure_unknown_events + 1
            emit(self, "unknown", "unknown")
            return false
        end
        self.counters.hangup_calls = self.counters.hangup_calls + 1
        self.counters.source_failure_hangups =
            self.counters.source_failure_hangups + 1
        return true
    end

    function state.is_connected()
        return state.call_state == "connected"
    end

    function state:metrics()
        local output = {}
        for key, value in pairs(self.counters) do output[key] = value end
        output.ready = self.ready
        output.call_state = self.call_state
        output.call_generation = self.call_generation
        output.record_configured = self.record_configured
        output.record_active = self.record_active
        output.audio_quality = self.audio_quality
        output.media_started = self.media_started
        output.memory_failed = self.memory_failed
        output.hangup_pending = self.hangup_pending
        output.last_raw_event = self.last_raw_event
        output.last_raw_event_ms = self.last_raw_event_ms
        output.record_started_ms = self.record_started_ms
        output.media_started_ms = self.media_started_ms
        if self.uplink then output.uplink = self.uplink:metrics() end
        return output
    end

    return state
end

return M
