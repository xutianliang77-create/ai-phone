local M = {}

local function require_value(condition, message)
    if not condition then error("vuart_v1_memory: " .. message, 0) end
end

local function non_negative_integer(value)
    return type(value) == "number" and value >= 0
        and value == math.floor(value)
end

local function valid_sample(total, used, peak)
    return non_negative_integer(total) and total > 0
        and non_negative_integer(used) and used <= total
        and non_negative_integer(peak) and peak >= used and peak <= total
end

function M.new(options)
    require_value(type(options) == "table", "options required")
    require_value(type(options.rtos_api) == "table", "rtos_api required")
    require_value(type(options.rtos_api.meminfo) == "function",
        "rtos.meminfo required")

    local minimum_lua_free = options.minimum_lua_free_bytes or 0
    local minimum_sys_free = options.minimum_sys_free_bytes or 0
    require_value(non_negative_integer(minimum_lua_free),
        "minimum_lua_free_bytes invalid")
    require_value(non_negative_integer(minimum_sys_free),
        "minimum_sys_free_bytes invalid")

    local state = {
        rtos_api = options.rtos_api,
        minimum_lua_free_bytes = minimum_lua_free,
        minimum_sys_free_bytes = minimum_sys_free,
        on_fault = options.on_fault or function() end,
        faulted = false,
        counters = {
            samples = 0,
            sample_failures = 0,
            low_memory_events = 0,
            minimum_lua_free_bytes = nil,
            minimum_sys_free_bytes = nil,
            maximum_lua_used_bytes = 0,
            maximum_sys_used_bytes = 0,
            maximum_lua_peak_bytes = 0,
            maximum_sys_peak_bytes = 0,
        },
    }

    local function fault(self, reason, snapshot)
        if self.faulted then return end
        self.faulted = true
        local called = pcall(self.on_fault, reason, snapshot)
        if not called then
            -- The monitor remains faulted even when the notification hook fails.
        end
    end

    local function read_memory(self, kind)
        local called, total, used, peak = pcall(self.rtos_api.meminfo, kind)
        if not called or not valid_sample(total, used, peak) then return nil end
        return total, used, peak, total - used
    end

    local function minimum(current, value)
        return current == nil and value or math.min(current, value)
    end

    function state:sample()
        local lua_total, lua_used, lua_peak, lua_free = read_memory(self, "lua")
        local sys_total, sys_used, sys_peak, sys_free = read_memory(self, "sys")
        if not lua_total or not sys_total then
            self.counters.sample_failures = self.counters.sample_failures + 1
            fault(self, "meminfo_invalid", nil)
            return false, nil
        end

        self.counters.samples = self.counters.samples + 1
        self.counters.minimum_lua_free_bytes = minimum(
            self.counters.minimum_lua_free_bytes, lua_free)
        self.counters.minimum_sys_free_bytes = minimum(
            self.counters.minimum_sys_free_bytes, sys_free)
        self.counters.maximum_lua_used_bytes = math.max(
            self.counters.maximum_lua_used_bytes, lua_used)
        self.counters.maximum_sys_used_bytes = math.max(
            self.counters.maximum_sys_used_bytes, sys_used)
        self.counters.maximum_lua_peak_bytes = math.max(
            self.counters.maximum_lua_peak_bytes, lua_peak)
        self.counters.maximum_sys_peak_bytes = math.max(
            self.counters.maximum_sys_peak_bytes, sys_peak)

        local snapshot = {
            lua_total = lua_total,
            lua_used = lua_used,
            lua_peak = lua_peak,
            lua_free = lua_free,
            sys_total = sys_total,
            sys_used = sys_used,
            sys_peak = sys_peak,
            sys_free = sys_free,
        }
        if lua_free < self.minimum_lua_free_bytes
            or sys_free < self.minimum_sys_free_bytes then
            self.counters.low_memory_events = self.counters.low_memory_events + 1
            fault(self, "low_memory", snapshot)
        end
        return not self.faulted, snapshot
    end

    function state:metrics()
        local output = {}
        for name, value in pairs(self.counters) do
            output[name] = value == nil and 0 or value
        end
        output.faulted = self.faulted
        output.minimum_lua_free_gate_bytes = self.minimum_lua_free_bytes
        output.minimum_sys_free_gate_bytes = self.minimum_sys_free_bytes
        return output
    end

    return state
end

return M
