local M = {}

local function require_value(condition, message)
    if not condition then error("vuart_v1_cc: " .. message, 0) end
end

function M.new(options)
    require_value(type(options) == "table", "options required")
    require_value(type(options.cc_api) == "table", "cc_api required")
    require_value(type(options.subscribe) == "function", "subscribe required")

    local state = {
        cc_api = options.cc_api,
        sim_id = options.sim_id or 0,
        zbuff_api = options.zbuff_api,
        uplink = options.uplink,
        enable_downlink = options.enable_downlink == true,
        buffer_size = options.buffer_size or 6400,
        telephony_ready = false,
        audio_ready = false,
        cc_initialized = false,
        record_configured = false,
        ready = false,
        call_state = "idle",
        audio_quality = 0,
        hangup_pending = false,
        terminal_emitted = false,
        last_event = nil,
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

    local function delete_buffer(buffer)
        if buffer then pcall(buffer.del, buffer) end
    end

    local function record_callback(self, is_downlink, point)
        local group = is_downlink and self.buffers.down or self.buffers.up
        local buffer = point == 0 and group[1] or point == 1 and group[2] or nil
        if not buffer then
            self.counters.downlink_drops = self.counters.downlink_drops + 1
            return
        end
        local used_ok, used = pcall(buffer.used, buffer)
        if not used_ok or type(used) ~= "number" then
            self.counters.downlink_drops = self.counters.downlink_drops + 1
            delete_buffer(buffer)
            return
        end
        if not is_downlink then
            self.counters.uplink_discarded =
                self.counters.uplink_discarded + 1
            delete_buffer(buffer)
            return
        end
        if used ~= self.buffer_size then
            self.counters.downlink_drops = self.counters.downlink_drops + 1
            delete_buffer(buffer)
            return
        end
        local query_ok, pcm = pcall(buffer.query, buffer)
        delete_buffer(buffer)
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
        local called, result = pcall(self.cc_api.record, true,
            buffers.up[1], buffers.up[2], buffers.down[1], buffers.down[2])
        if not registered or not called or result ~= true then
            self.counters.record_failures = self.counters.record_failures + 1
            return false
        end
        self.record_configured = true
        return true
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
        self.terminal_emitted = true
        emit(self, carrier_state, carrier_cause)
        self.call_state = "idle"
        self.audio_quality = 0
        self.hangup_pending = false
    end

    local function carrier_event(self, status)
        self.counters.carrier_events = self.counters.carrier_events + 1
        if status == "READY" then
            self.telephony_ready = true
            maybe_initialize(self)
        elseif status == "MAKE_CALL_OK" and self.call_state == "dialing" then
            emit(self, "dialing", "none")
        elseif (status == "CONNECTED" or status == "SPEECH_START"
            or status == "AUDIO_START") and self.call_state ~= "idle" then
            self.call_state = "connected"
            if status == "AUDIO_START" then
                local called, quality = pcall(self.cc_api.quality)
                if called and (quality == 1 or quality == 2) then
                    self.audio_quality = quality
                else
                    self.audio_quality = 0
                    self.counters.quality_failures =
                        self.counters.quality_failures + 1
                end
            end
            emit(self, "connected", "none")
        elseif status == "EXT_SRC_DONE" and self.uplink then
            local metrics = self.uplink:metrics()
            self.uplink:on_done(metrics.generation)
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
        local called, result = pcall(state.cc_api.dial, state.sim_id,
            command.dial_target_e164)
        if not called or result ~= true then
            return { status = "rejected", error_code = "internal_error" }
        end
        state.counters.dial_calls = state.counters.dial_calls + 1
        state.call_state = "dialing"
        state.audio_quality = 0
        state.hangup_pending = false
        state.terminal_emitted = false
        state.last_event = nil
        return { status = "applied" }
    end

    function state.hangup(_command)
        if not state.ready or state.call_state == "idle"
            or state.hangup_pending then
            return { status = "rejected", error_code = "invalid_state" }
        end
        local called = pcall(state.cc_api.hangUp, state.sim_id)
        if not called then
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
            or state.audio_quality == 0 or type(state.uplink) ~= "table" then
            state.counters.uplink_drops = state.counters.uplink_drops + 1
            return false
        end
        local metrics = state.uplink:metrics()
        if not metrics.call_active then
            if not state.uplink:begin_call(generation, state.audio_quality) then
                state.counters.uplink_drops = state.counters.uplink_drops + 1
                return false
            end
        end
        local accepted = state.uplink:enqueue(generation, media_sequence, pcm)
        if accepted then
            state.counters.uplink_frames = state.counters.uplink_frames + 1
        else
            state.counters.uplink_drops = state.counters.uplink_drops + 1
        end
        return accepted == true
    end

    function state.stop_uplink(generation)
        if type(state.uplink) ~= "table" then return true end
        local metrics = state.uplink:metrics()
        if not metrics.call_active then return true end
        return state.uplink:stop(generation)
    end

    function state.is_connected()
        return state.call_state == "connected"
    end

    function state:metrics()
        local output = {}
        for key, value in pairs(self.counters) do output[key] = value end
        output.ready = self.ready
        output.call_state = self.call_state
        output.record_configured = self.record_configured
        output.audio_quality = self.audio_quality
        if self.uplink then output.uplink = self.uplink:metrics() end
        return output
    end

    return state
end

return M
