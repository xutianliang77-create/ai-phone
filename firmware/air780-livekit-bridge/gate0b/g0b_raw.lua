local M = {}
local MAX_CHUNKS = 50
local FORMAT_BY_QUALITY = {
    [1] = {sample_rate = 8000, chunk_size = 3200},
    [2] = {sample_rate = 16000, chunk_size = 6400},
}
local MAX_INPUT_CALLS_PER_PUMP = 4
local LATE_PUMP_MS = 50
local function require_value(condition, message)
    if not condition then error("g0b_raw: " .. message, 0) end
end
local function pcm_for(chunk_index, chunk_size)
    local positive = string.char(0, 16)
    local negative = string.char(0, 240)
    local span = chunk_index % 2 == 1 and 8 or 10
    local period = string.rep(positive, span) .. string.rep(negative, span)
    return string.rep(period, chunk_size / #period)
end
local function is_nonnegative_integer(value)
    return type(value) == "number" and value >= 0 and value % 1 == 0
end
function M.new(options)
    require_value(type(options) == "table", "options required")
    require_value(type(options.cc_api) == "table", "cc_api required")
    require_value(type(options.cc_api.extern_source) == "function",
        "extern_source required")
    require_value(type(options.cc_api.input) == "function", "input required")
    require_value(options.raw_codec == 0, "RAW codec must be 0")

    local max_calls = options.max_input_calls_per_pump
        or MAX_INPUT_CALLS_PER_PUMP
    require_value(is_nonnegative_integer(max_calls) and max_calls >= 1
        and max_calls <= 16, "invalid pump call limit")

    local state = {
        cc_api = options.cc_api,
        raw_codec = options.raw_codec,
        now_ms = options.now_ms or function() return 0 end,
        max_input_calls_per_pump = max_calls,
        generation = 0,
        last_generation = 0,
        quality = 0,
        sample_rate = 0,
        chunk_size = 0,
        requested_chunks = 0,
        next_chunk = 1,
        pending_data = nil,
        pending_offset = 1,
        sequence_consumed = false,
        started = false,
        active = false,
        awaiting_done = false,
        end_sent = false,
        stream_done = false,
        cancel_pending = false,
        cancelled = false,
        stream_starts = 0,
        start_failures = 0,
        input_calls = 0,
        input_failures = 0,
        written_chunks = 0,
        written_bytes = 0,
        partial_writes = 0,
        zero_writes = 0,
        backpressure_events = 0,
        end_calls = 0,
        end_failures = 0,
        stop_calls = 0,
        stop_failures = 0,
        stale_generation_rejections = 0,
        stray_done = 0,
        premature_done = 0,
        pump_calls = 0,
        late_pumps = 0,
        started_ms = nil,
        last_pump_ms = nil,
        max_pump_interval_ms = nil,
        last_write_ms = nil,
        done_ms = nil,
        last_free_len = nil,
        min_free_len = nil,
    }
    local function clear_pending(self)
        self.pending_data = nil
        self.pending_offset = 1
    end
    local function stop_source(self)
        self.stop_calls = self.stop_calls + 1
        local called, accepted = pcall(self.cc_api.extern_source, nil)
        clear_pending(self)
        if called and accepted == true then
            self.active = false
            self.awaiting_done = false
            self.cancel_pending = false
            return true
        end
        self.stop_failures = self.stop_failures + 1
        self.cancel_pending = true
        return false
    end
    local function fail_input(self, is_end)
        if is_end then
            self.end_failures = self.end_failures + 1
        else
            self.input_failures = self.input_failures + 1
        end
        self.cancelled = true
        stop_source(self)
        return false
    end
    local function observe_free(self, free_len)
        self.last_free_len = free_len
        self.min_free_len = self.min_free_len
            and math.min(self.min_free_len, free_len) or free_len
    end
    local function send_end(self)
        self.end_calls = self.end_calls + 1
        local called, accepted, written, free_len = pcall(
            self.cc_api.input, true, "", true)
        if not called or accepted ~= true or written ~= 0
            or not is_nonnegative_integer(free_len) then
            return fail_input(self, true)
        end
        observe_free(self, free_len)
        self.end_sent = true
        self.awaiting_done = true
        return true
    end
    local function observe_pump(self)
        local now = self.now_ms()
        self.pump_calls = self.pump_calls + 1
        if self.last_pump_ms then
            local interval = now - self.last_pump_ms
            if interval >= 0 then
                self.max_pump_interval_ms = self.max_pump_interval_ms
                    and math.max(self.max_pump_interval_ms, interval) or interval
                if interval > LATE_PUMP_MS then
                    self.late_pumps = self.late_pumps + 1
                end
            end
        end
        self.last_pump_ms = now
    end
    function state:begin_call(generation, quality)
        if self.active or self.cancel_pending then return false end
        if type(generation) ~= "number" or generation % 1 ~= 0
            or generation <= self.last_generation then return false end
        local format = FORMAT_BY_QUALITY[quality]
        if not format then return false end

        self.generation = generation
        self.last_generation = generation
        self.quality = quality
        self.sample_rate = format.sample_rate
        self.chunk_size = format.chunk_size
        self.requested_chunks = 0
        self.next_chunk = 1
        clear_pending(self)
        self.sequence_consumed = false
        self.started = false
        self.active = false
        self.awaiting_done = false
        self.end_sent = false
        self.stream_done = false
        self.cancel_pending = false
        self.cancelled = false
        self.stream_starts = 0
        self.start_failures = 0
        self.input_calls = 0
        self.input_failures = 0
        self.written_chunks = 0
        self.written_bytes = 0
        self.partial_writes = 0
        self.zero_writes = 0
        self.backpressure_events = 0
        self.end_calls = 0
        self.end_failures = 0
        self.stop_calls = 0
        self.stop_failures = 0
        self.stale_generation_rejections = 0
        self.stray_done = 0
        self.premature_done = 0
        self.pump_calls = 0
        self.late_pumps = 0
        self.started_ms = nil
        self.last_pump_ms = nil
        self.max_pump_interval_ms = nil
        self.last_write_ms = nil
        self.done_ms = nil
        self.last_free_len = nil
        self.min_free_len = nil
        return true
    end
    function state:pump(expected_generation)
        if expected_generation ~= self.generation then
            self.stale_generation_rejections =
                self.stale_generation_rejections + 1
            return false
        end
        if not self.active then return false end
        if self.cancel_pending or self.end_sent then return true end
        observe_pump(self)

        for _ = 1, self.max_input_calls_per_pump do
            if not self.pending_data then
                if self.next_chunk > self.requested_chunks then
                    return send_end(self)
                end
                self.pending_data = pcm_for(self.next_chunk, self.chunk_size)
                self.pending_offset = 1
            end

            local remaining = self.pending_data:sub(self.pending_offset)
            self.input_calls = self.input_calls + 1
            local called, accepted, written, free_len = pcall(
                self.cc_api.input, true, remaining, false)
            if not called or accepted ~= true
                or not is_nonnegative_integer(written)
                or written > #remaining
                or not is_nonnegative_integer(free_len) then
                return fail_input(self, false)
            end
            observe_free(self, free_len)

            if written == 0 then
                self.zero_writes = self.zero_writes + 1
                if free_len == 0 then
                    self.backpressure_events = self.backpressure_events + 1
                end
                return true
            end

            self.written_bytes = self.written_bytes + written
            self.last_write_ms = self.now_ms()
            if written < #remaining then
                self.partial_writes = self.partial_writes + 1
            end
            self.pending_offset = self.pending_offset + written
            if self.pending_offset > #self.pending_data then
                self.written_chunks = self.written_chunks + 1
                self.next_chunk = self.next_chunk + 1
                clear_pending(self)
            end
            if free_len == 0 then
                self.backpressure_events = self.backpressure_events + 1
                return true
            end
        end
        return true
    end
    function state:start(chunk_count)
        if self.sequence_consumed or self.started or self.active then return false end
        if type(chunk_count) ~= "number" or chunk_count % 1 ~= 0
            or chunk_count < 1 or chunk_count > MAX_CHUNKS then return false end

        self.requested_chunks = chunk_count
        self.sequence_consumed = true
        self.started = true
        self.started_ms = self.now_ms()
        local called, accepted = pcall(self.cc_api.extern_source,
            true, true, self.raw_codec, true, self.sample_rate, 16, 1, true)
        if not called or accepted ~= true then
            self.start_failures = self.start_failures + 1
            self.started = false
            return false
        end
        self.stream_starts = self.stream_starts + 1
        self.active = true
        return self:pump(self.generation)
    end
    function state:on_ext_src_done(expected_generation)
        if expected_generation ~= self.generation then
            self.stale_generation_rejections =
                self.stale_generation_rejections + 1
            return false
        end
        if not self.active then
            self.stray_done = self.stray_done + 1
            return false
        end
        if not self.end_sent and not self.cancel_pending then
            self.premature_done = self.premature_done + 1
            self.cancelled = true
            self.active = false
            clear_pending(self)
            return false
        end
        self.stream_done = true
        self.done_ms = self.now_ms()
        self.active = false
        self.awaiting_done = false
        self.cancel_pending = false
        clear_pending(self)
        return true
    end
    function state:clear(_reason)
        if not self.active then return true end
        self.cancelled = true
        return stop_source(self)
    end
    function state:stats()
        local pending_bytes = self.pending_data
            and (#self.pending_data - self.pending_offset + 1) or 0
        return {
            generation = self.generation,
            active = self.active,
            started = self.started,
            cancelled = self.cancelled,
            cancel_pending = self.cancel_pending,
            sequence_consumed = self.sequence_consumed,
            awaiting_done = self.awaiting_done,
            end_sent = self.end_sent,
            stream_done = self.stream_done,
            quality = self.quality,
            sample_rate = self.sample_rate,
            chunk_size = self.chunk_size,
            requested_chunks = self.requested_chunks,
            requested_bytes = self.requested_chunks * self.chunk_size,
            written_chunks = self.written_chunks,
            written_bytes = self.written_bytes,
            pending_bytes = pending_bytes,
            stream_starts = self.stream_starts,
            start_failures = self.start_failures,
            input_calls = self.input_calls,
            input_failures = self.input_failures,
            partial_writes = self.partial_writes,
            zero_writes = self.zero_writes,
            backpressure_events = self.backpressure_events,
            end_calls = self.end_calls,
            end_failures = self.end_failures,
            stop_calls = self.stop_calls,
            stop_failures = self.stop_failures,
            stale_generation_rejections = self.stale_generation_rejections,
            stray_done = self.stray_done,
            premature_done = self.premature_done,
            pump_calls = self.pump_calls,
            late_pumps = self.late_pumps,
            started_ms = self.started_ms,
            last_pump_ms = self.last_pump_ms,
            max_pump_interval_ms = self.max_pump_interval_ms,
            last_write_ms = self.last_write_ms,
            done_ms = self.done_ms,
            last_free_len = self.last_free_len,
            min_free_len = self.min_free_len,
        }
    end

    return state
end
return M
