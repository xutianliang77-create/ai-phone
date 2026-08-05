local M = {}

local function require_value(condition, message)
    if not condition then error("vuart_v1_uart: " .. message, 0) end
end

function M.new(options)
    require_value(type(options) == "table", "options required")
    require_value(type(options.uart_api) == "table", "uart_api required")
    require_value(type(options.sys_api) == "table", "sys_api required")
    require_value(options.uart_id ~= nil, "uart_id required")
    require_value(type(options.on_bytes) == "function", "on_bytes required")

    local state = {
        uart_api = options.uart_api,
        sys_api = options.sys_api,
        uart_id = options.uart_id,
        on_bytes = options.on_bytes,
        queue_limit = options.queue_limit or 8,
        max_read_bytes = options.max_read_bytes or 8192,
        max_reads_per_callback = options.max_reads_per_callback or 4,
        max_writes_per_pump = options.max_writes_per_pump or 4,
        retry_ms = options.retry_ms or 10,
        opened = false,
        pumping = false,
        retry_pending = false,
        active = nil,
        offset = 1,
        queue = {},
        counters = {
            rx_callbacks = 0, rx_bytes = 0, rx_errors = 0,
            tx_frames = 0, tx_completed = 0, tx_dropped = 0,
            tx_write_calls = 0, tx_bytes = 0, tx_zero_or_error = 0,
        },
    }

    local function depth(self)
        return #self.queue + (self.active and 1 or 0)
    end

    local pump

    local function schedule_retry(self)
        if self.retry_pending or not self.opened then return end
        self.retry_pending = true
        self.sys_api.timerStart(function()
            self.retry_pending = false
            if self.opened then pump(self) end
        end, self.retry_ms)
    end

    pump = function(self)
        if self.pumping or not self.opened then return end
        self.pumping = true
        local remaining = self.max_writes_per_pump
        while remaining > 0 do
            if not self.active then
                self.active = table.remove(self.queue, 1)
                self.offset = 1
            end
            if not self.active then break end
            local requested = #self.active - self.offset + 1
            local called, result = pcall(self.uart_api.write, self.uart_id,
                self.active:sub(self.offset))
            self.counters.tx_write_calls = self.counters.tx_write_calls + 1
            local accepted = called and tonumber(result) or 0
            if not accepted or accepted <= 0 then
                self.counters.tx_zero_or_error =
                    self.counters.tx_zero_or_error + 1
                break
            end
            if accepted > requested then accepted = requested end
            self.counters.tx_bytes = self.counters.tx_bytes + accepted
            self.offset = self.offset + accepted
            if self.offset > #self.active then
                self.active = nil
                self.counters.tx_completed = self.counters.tx_completed + 1
            end
            remaining = remaining - 1
        end
        self.pumping = false
        if self.active or #self.queue > 0 then schedule_retry(self) end
    end

    local function receive(self, id, length)
        if not self.opened or id ~= self.uart_id then return end
        self.counters.rx_callbacks = self.counters.rx_callbacks + 1
        local requested = tonumber(length)
        local reads = 0
        repeat
            local limit = self.max_read_bytes
            if requested and requested > 0 then limit = math.min(limit, requested) end
            local called, chunk = pcall(self.uart_api.read, self.uart_id, limit)
            if not called then
                self.counters.rx_errors = self.counters.rx_errors + 1
                return
            end
            if type(chunk) ~= "string" or #chunk == 0 then return end
            self.counters.rx_bytes = self.counters.rx_bytes + #chunk
            local delivered = pcall(self.on_bytes, chunk)
            if not delivered then
                self.counters.rx_errors = self.counters.rx_errors + 1
            end
            reads = reads + 1
            if requested then requested = requested - #chunk end
        until reads >= self.max_reads_per_callback or not requested or requested <= 0
    end

    function state:open()
        if self.opened then return true end
        local called, result = pcall(self.uart_api.setup, self.uart_id,
            115200, 8, 1)
        if not called or result ~= 0 then return false end
        self.opened = true
        local registered = pcall(self.uart_api.on, self.uart_id, "receive",
            function(id, length) receive(self, id, length) end)
        if not registered then
            self.opened = false
            pcall(self.uart_api.close, self.uart_id)
            return false
        end
        return true
    end

    function state:write(bytes)
        if not self.opened or type(bytes) ~= "string" or #bytes == 0 then
            return false
        end
        if depth(self) >= self.queue_limit then
            self.counters.tx_dropped = self.counters.tx_dropped + 1
            return false
        end
        self.queue[#self.queue + 1] = bytes
        self.counters.tx_frames = self.counters.tx_frames + 1
        pump(self)
        return true
    end

    function state:close()
        if self.opened then pcall(self.uart_api.close, self.uart_id) end
        self.opened = false
        self.active = nil
        self.offset = 1
        self.queue = {}
    end

    function state:metrics()
        local output = {}
        for key, value in pairs(self.counters) do output[key] = value end
        output.opened = self.opened
        output.queue_depth = depth(self)
        output.queue_limit = self.queue_limit
        return output
    end

    return state
end

return M
