local frame_codec = require("vuart_v1_codec")

local M = {}
local HEADER_BYTES = 20
local TRAILER_BYTES = 4
local FRAME_VERSION = 1

local function require_value(condition, message)
    if not condition then error("vuart_v1_stream: " .. message, 0) end
end

function M.new(options)
    options = options or {}
    local max_payload_bytes = options.max_payload_bytes or 65535
    require_value(type(max_payload_bytes) == "number"
        and max_payload_bytes >= 1 and max_payload_bytes <= 65535
        and max_payload_bytes == math.floor(max_payload_bytes),
        "max_payload_bytes must be uint16")
    local max_frame_bytes = max_payload_bytes + HEADER_BYTES + TRAILER_BYTES
    local max_buffer_bytes = options.max_buffer_bytes or max_frame_bytes * 4
    require_value(type(max_buffer_bytes) == "number"
        and max_buffer_bytes >= max_frame_bytes
        and max_buffer_bytes == math.floor(max_buffer_bytes),
        "max_buffer_bytes must hold at least one frame")

    local state = {
        buffer = "",
        max_payload_bytes = max_payload_bytes,
        max_buffer_bytes = max_buffer_bytes,
        counters = {
            bytes_received = 0,
            frames_decoded = 0,
            invalid_frames = 0,
            buffer_overflows = 0,
            discarded_bytes = 0,
            buffered_bytes = 0,
            peak_buffered_bytes = 0,
            max_buffer_bytes = max_buffer_bytes,
        },
    }

    function state:feed(chunk)
        require_value(type(chunk) == "string", "binary chunk required")
        self.counters.bytes_received = self.counters.bytes_received + #chunk
        if #self.buffer + #chunk > self.max_buffer_bytes then
            self.counters.buffer_overflows = self.counters.buffer_overflows + 1
            self.counters.discarded_bytes = self.counters.discarded_bytes
                + #self.buffer + #chunk
            self.buffer = ""
            self.counters.buffered_bytes = 0
            return {}
        end
        self.buffer = self.buffer .. chunk
        self.counters.peak_buffered_bytes = math.max(
            self.counters.peak_buffered_bytes, #self.buffer)
        local frames = {}

        while true do
            local magic = self.buffer:find("AI", 1, true)
            if not magic then
                local keep = self.buffer:sub(-1) == "A" and "A" or ""
                self.counters.discarded_bytes = self.counters.discarded_bytes
                    + #self.buffer - #keep
                self.buffer = keep
                break
            end
            if magic > 1 then
                self.counters.discarded_bytes = self.counters.discarded_bytes
                    + magic - 1
                self.buffer = self.buffer:sub(magic)
            end
            if #self.buffer < HEADER_BYTES then break end

            if self.buffer:byte(3) ~= FRAME_VERSION then
                self.counters.invalid_frames = self.counters.invalid_frames + 1
                self.counters.discarded_bytes = self.counters.discarded_bytes + 1
                self.buffer = self.buffer:sub(2)
            else
                local payload_bytes = self.buffer:byte(19)
                    + self.buffer:byte(20) * 256
                if payload_bytes > self.max_payload_bytes then
                    self.counters.invalid_frames = self.counters.invalid_frames + 1
                    self.counters.discarded_bytes = self.counters.discarded_bytes + 1
                    self.buffer = self.buffer:sub(2)
                else
                    local frame_bytes = HEADER_BYTES + payload_bytes + TRAILER_BYTES
                    if #self.buffer < frame_bytes then break end
                    local encoded = self.buffer:sub(1, frame_bytes)
                    self.buffer = self.buffer:sub(frame_bytes + 1)
                    local decoded = frame_codec.decode_frame(encoded)
                    if decoded then
                        frames[#frames + 1] = decoded
                        self.counters.frames_decoded =
                            self.counters.frames_decoded + 1
                    else
                        self.counters.invalid_frames =
                            self.counters.invalid_frames + 1
                        self.counters.discarded_bytes =
                            self.counters.discarded_bytes + frame_bytes
                    end
                end
            end
        end

        self.counters.buffered_bytes = #self.buffer
        require_value(#self.buffer <= self.max_buffer_bytes,
            "buffer bound exceeded")
        return frames
    end

    function state:metrics()
        local output = {}
        for key, value in pairs(self.counters) do output[key] = value end
        return output
    end

    return state
end

return M
