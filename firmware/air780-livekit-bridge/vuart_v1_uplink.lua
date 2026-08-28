local M = {}
local FORMAT_BY_QUALITY = {
    [1] = { sample_rate = 8000, chunk_size = 3200 },
    [2] = { sample_rate = 16000, chunk_size = 6400 },
}
local SOURCE_PCM_BYTES = 6400
local RETRY_MS = 10

local function require_value(condition, message)
    if not condition then error("vuart_v1_uplink: " .. message, 0) end
end

local function is_uint32(value)
    return type(value) == "number" and value >= 0 and value <= 0xffffffff
        and value == math.floor(value)
end

local function signed_sample(low, high)
    local value = low + high * 256
    return value >= 32768 and value - 65536 or value
end

local function sample_bytes(value)
    value = math.floor(value)
    if value < 0 then value = value + 65536 end
    return string.char(value % 256, math.floor(value / 256) % 256)
end

local function carrier_pcm(pcm, sample_rate)
    if sample_rate == 16000 then return pcm end
    local output = {}
    for offset = 1, #pcm, 4 do
        local first = signed_sample(pcm:byte(offset), pcm:byte(offset + 1))
        local second = signed_sample(pcm:byte(offset + 2), pcm:byte(offset + 3))
        output[#output + 1] = sample_bytes((first + second) / 2)
    end
    return table.concat(output)
end

function M.new(options)
    require_value(type(options) == "table", "options required")
    require_value(type(options.cc_api) == "table", "cc_api required")
    require_value(type(options.cc_api.extern_source) == "function",
        "extern_source required")
    require_value(type(options.cc_api.input) == "function", "input required")
    require_value(type(options.schedule) == "function", "schedule required")
    require_value(options.raw_codec == 0, "RAW codec must be 0")
    local capacity = options.capacity_chunks or 2
    require_value(type(capacity) == "number" and capacity >= 1
        and capacity <= 8 and capacity == math.floor(capacity),
        "capacity_chunks must be 1..8")

    local state = {
        cc_api = options.cc_api,
        schedule = options.schedule,
        raw_codec = options.raw_codec,
        capacity_chunks = capacity,
        generation = 0,
        last_generation = 0,
        quality = 0,
        sample_rate = 0,
        chunk_size = 0,
        call_active = false,
        source_active = false,
        stop_pending = false,
        faulted = false,
        queue = {},
        pending_data = nil,
        pending_offset = 1,
        pump_scheduled = false,
        last_media_sequence = nil,
        counters = {
            calls_started = 0, source_starts = 0, source_start_failures = 0,
            chunks_received = 0, chunks_written = 0, bytes_written = 0,
            input_calls = 0, input_failures = 0, partial_writes = 0,
            zero_writes = 0, backpressure_events = 0, dropped_chunks = 0,
            duplicate_chunks = 0, out_of_order_chunks = 0,
            sequence_gap_events = 0, missing_chunks = 0,
            stale_generation_rejections = 0, invalid_chunks = 0,
            stop_calls = 0, stop_failures = 0, premature_done = 0,
            stray_done = 0,
        },
    }

    local function clear_pending(self)
        self.queue = {}
        self.pending_data = nil
        self.pending_offset = 1
        self.pump_scheduled = false
    end

    local function outstanding(self)
        return #self.queue + (self.pending_data and 1 or 0)
    end

    local function schedule_pump(self)
        if self.pump_scheduled or not self.call_active
            or not self.source_active then return end
        self.pump_scheduled = true
        local generation = self.generation
        self.schedule(function() self:pump(generation) end, RETRY_MS)
    end

    local function start_source(self)
        if self.source_active then return true end
        local called, accepted = pcall(self.cc_api.extern_source,
            true, true, self.raw_codec, true, self.sample_rate, 16, 1, true)
        if not called or accepted ~= true then
            self.counters.source_start_failures =
                self.counters.source_start_failures + 1
            return false
        end
        self.source_active = true
        self.counters.source_starts = self.counters.source_starts + 1
        return true
    end

    function state:begin_call(generation, quality)
        if self.call_active or not is_uint32(generation)
            or generation <= self.last_generation then
            self.counters.stale_generation_rejections =
                self.counters.stale_generation_rejections + 1
            return false
        end
        local format = FORMAT_BY_QUALITY[quality]
        if not format then return false end
        clear_pending(self)
        self.generation = generation
        self.last_generation = generation
        self.quality = quality
        self.sample_rate = format.sample_rate
        self.chunk_size = format.chunk_size
        self.call_active = true
        self.source_active = false
        self.stop_pending = false
        self.faulted = false
        self.last_media_sequence = nil
        self.counters.calls_started = self.counters.calls_started + 1
        return true
    end

    function state:enqueue(generation, media_sequence, pcm)
        if generation ~= self.generation or not self.call_active then
            self.counters.stale_generation_rejections =
                self.counters.stale_generation_rejections + 1
            return false, "stale_generation"
        end
        if self.faulted or not is_uint32(media_sequence)
            or type(pcm) ~= "string" or #pcm ~= SOURCE_PCM_BYTES then
            self.counters.invalid_chunks = self.counters.invalid_chunks + 1
            return false, "invalid_chunk"
        end
        if media_sequence == self.last_media_sequence then
            self.counters.duplicate_chunks = self.counters.duplicate_chunks + 1
            return false, "duplicate"
        end
        if self.last_media_sequence and media_sequence < self.last_media_sequence then
            self.counters.out_of_order_chunks =
                self.counters.out_of_order_chunks + 1
            return false, "out_of_order"
        end
        if self.last_media_sequence and
            media_sequence > self.last_media_sequence + 1 then
            self.counters.sequence_gap_events =
                self.counters.sequence_gap_events + 1
            self.counters.missing_chunks = self.counters.missing_chunks
                + media_sequence - self.last_media_sequence - 1
        end
        self.last_media_sequence = media_sequence
        self.counters.chunks_received = self.counters.chunks_received + 1
        if outstanding(self) >= self.capacity_chunks then
            self.counters.backpressure_events =
                self.counters.backpressure_events + 1
            self.counters.dropped_chunks = self.counters.dropped_chunks + 1
            return false, "backpressure"
        end
        local converted = carrier_pcm(pcm, self.sample_rate)
        if #converted ~= self.chunk_size then
            self.counters.invalid_chunks = self.counters.invalid_chunks + 1
            return false, "invalid_chunk"
        end
        self.queue[#self.queue + 1] = converted
        if not start_source(self) then
            table.remove(self.queue)
            self.counters.dropped_chunks = self.counters.dropped_chunks + 1
            self.faulted = true
            return false, "source_start"
        end
        if not self:pump(generation) then
            return false, "input_failure"
        end
        return true
    end

    function state:pump(generation)
        self.pump_scheduled = false
        if generation ~= self.generation or not self.call_active
            or not self.source_active then
            self.counters.stale_generation_rejections =
                self.counters.stale_generation_rejections + 1
            return false
        end
        if not self.pending_data then
            self.pending_data = table.remove(self.queue, 1)
            self.pending_offset = 1
        end
        if not self.pending_data then return true end

        local remaining = self.pending_data:sub(self.pending_offset)
        self.counters.input_calls = self.counters.input_calls + 1
        local called, accepted, written, free_len = pcall(
            self.cc_api.input, true, remaining, false)
        if not called or accepted ~= true or type(written) ~= "number"
            or written < 0 or written > #remaining or written % 1 ~= 0
            or type(free_len) ~= "number" or free_len < 0
            or free_len % 1 ~= 0 then
            self.counters.input_failures = self.counters.input_failures + 1
            self.faulted = true
            return false
        end
        if written == 0 then
            self.counters.zero_writes = self.counters.zero_writes + 1
            if free_len == 0 then
                self.counters.backpressure_events =
                    self.counters.backpressure_events + 1
            end
            schedule_pump(self)
            return true
        end
        self.counters.bytes_written = self.counters.bytes_written + written
        if written < #remaining then
            self.counters.partial_writes = self.counters.partial_writes + 1
        end
        self.pending_offset = self.pending_offset + written
        if self.pending_offset > #self.pending_data then
            self.pending_data = nil
            self.pending_offset = 1
            self.counters.chunks_written = self.counters.chunks_written + 1
        end
        if self.pending_data or #self.queue > 0 then schedule_pump(self) end
        return true
    end

    function state:stop(generation)
        if generation ~= self.generation or not self.call_active then
            self.counters.stale_generation_rejections =
                self.counters.stale_generation_rejections + 1
            return false
        end
        self.call_active = false
        self.counters.stop_calls = self.counters.stop_calls + 1
        clear_pending(self)
        if not self.source_active then return true end
        local called, accepted = pcall(self.cc_api.extern_source, nil)
        self.source_active = false
        if called and accepted == true then
            self.stop_pending = true
            return true
        end
        self.counters.stop_failures = self.counters.stop_failures + 1
        return false
    end

    function state:on_done(generation)
        if generation ~= self.generation then
            self.counters.stale_generation_rejections =
                self.counters.stale_generation_rejections + 1
            return false
        end
        if self.stop_pending then
            self.stop_pending = false
            return true
        end
        if not self.source_active then
            self.counters.stray_done = self.counters.stray_done + 1
            return false
        end
        self.source_active = false
        if self.call_active then
            self.counters.premature_done = self.counters.premature_done + 1
            self.faulted = true
            clear_pending(self)
            return false
        end
        return true
    end

    function state:metrics()
        local result = {}
        for name, value in pairs(self.counters) do result[name] = value end
        result.generation = self.generation
        result.quality = self.quality
        result.sample_rate = self.sample_rate
        result.chunk_size = self.chunk_size
        result.call_active = self.call_active
        result.source_active = self.source_active
        result.stop_pending = self.stop_pending
        result.faulted = self.faulted
        result.queue_depth = outstanding(self)
        result.pending_bytes = self.pending_data
            and #self.pending_data - self.pending_offset + 1 or 0
        return result
    end

    return state
end

return M
