PROJECT = "WUJIE_AIR_VUART_V1_PROD"
VERSION = "001.004.001"

local WATCHDOG_PIN = 24
local WATCHDOG_FEED_INTERVAL_MS = 10000
local HEARTBEAT_INTERVAL_MS = 5000
local AUDIO_BUFFER_SIZE = 6400
local CAPABILITY_FLAGS = 0x07
local REQUIRED_CORE_VERSION = 2048
local MEMORY_SAMPLE_INTERVAL_MS = 3000
local MINIMUM_LUA_FREE_BYTES = 131072
local MINIMUM_SYS_FREE_BYTES = 131072

local air153C_wtd = require("air153C_wtd")
local exaudio = require("exaudio")
local runtime_module = require("vuart_v1_runtime")
local uart_module = require("vuart_v1_uart")
local cc_module = require("vuart_v1_cc")
local uplink_module = require("vuart_v1_uplink")
local memory_module = require("vuart_v1_memory")

-- LuatOS hardware APIs can be indexable host objects rather than Lua tables.
-- Normalize only the functions used by the testable transport adapters.
local UART_API = {
    setup = uart.setup,
    on = uart.on,
    read = uart.read,
    write = uart.write,
    close = uart.close,
}
local CC_API = {
    init = cc.init,
    on = cc.on,
    record = cc.record,
    dial = cc.dial,
    hangUp = cc.hangUp,
    quality = cc.quality,
    extern_source = cc.extern_source,
    input = cc.input,
}
local ZBUFF_API = {
    HEAP_AUTO = zbuff.HEAP_AUTO,
    create = zbuff.create,
}
local RTOS_API = {
    meminfo = rtos.meminfo,
}

local AUDIO_CONFIG = {
    model = "es8311",
    audio_mode = "new",
    i2c_id = 0,
    pa_ctrl = gpio.AUDIOPA_EN,
    dac_ctrl = 20,
    dac_delay = 6,
    pa_delay = 100,
    dac_time_delay = 100,
    bits_per_sample = 16,
    pa_on_level = 1,
}

local function binary_hex(value)
    if type(value) ~= "string" or #value == 0 then return nil end
    return (value:gsub(".", function(byte)
        return string.format("%02x", byte:byte())
    end))
end

local function device_id()
    local called, value = pcall(mcu.unique_id)
    local encoded = called and binary_hex(value) or nil
    if encoded then return "air780-" .. encoded end
    local mobile_api = rawget(_G, "mobile")
    if mobile_api and type(mobile_api.imei) == "function" then
        called, value = pcall(mobile_api.imei)
        if called and type(value) == "string" and value:match("^%d+$") then
            return "air780-" .. value
        end
    end
    return nil
end

local function boot_id()
    local crypto_api = rawget(_G, "crypto")
    if not crypto_api or type(crypto_api.trng) ~= "function" then return nil end
    local called, value = pcall(crypto_api.trng, 16)
    if not called or type(value) ~= "string" or #value ~= 16 then return nil end
    return binary_hex(value)
end

local function tick_now()
    local high, low = mcu.ticks2(1)
    return high * 1000000 + low
end

local function detected_core_version()
    if not rtos or type(rtos.version) ~= "function" then return nil end
    local called, version = pcall(rtos.version)
    if not called or type(version) ~= "string" then return nil end
    return tonumber(version:match("[Vv](%d+)"))
end

local function stream_capability()
    local core_version = detected_core_version()
    if not core_version or core_version < REQUIRED_CORE_VERSION then
        return false, "requires_v2048", core_version
    end
    if type(CC_API.extern_source) ~= "function"
        or type(CC_API.input) ~= "function" then
        return false, "cc_stream_api_unavailable", core_version
    end
    return true, "ready", core_version
end

local boot_tick = tick_now()
local function uptime_ms()
    local elapsed = tick_now() - boot_tick
    if elapsed < 0 then elapsed = 0 end
    return tostring(elapsed)
end

local function feed_external_watchdog()
    air153C_wtd.feed_dog(WATCHDOG_PIN)
end

air153C_wtd.init(WATCHDOG_PIN)
feed_external_watchdog()
sys.timerLoopStart(feed_external_watchdog, WATCHDOG_FEED_INTERVAL_MS)

local resolved_device_id = device_id()
local resolved_boot_id = boot_id()
local stream_supported, stream_reason, stream_core_version = stream_capability()

if not stream_supported then
    log.error("vuart_v1_prod", stream_reason, tostring(stream_core_version))
elseif not resolved_device_id or not resolved_boot_id then
    log.error("vuart_v1_prod", "identity initialization failed")
else
    local runtime
    local transport
    local carrier
    local started = false
    local memory_monitor = memory_module.new({
        rtos_api = RTOS_API,
        minimum_lua_free_bytes = MINIMUM_LUA_FREE_BYTES,
        minimum_sys_free_bytes = MINIMUM_SYS_FREE_BYTES,
        on_fault = function(reason)
            if carrier and type(carrier.fail_closed) == "function" then
                pcall(carrier.fail_closed, carrier, reason)
            end
            if runtime and type(runtime.quarantine) == "function" then
                pcall(runtime.quarantine, runtime)
            end
            if transport and type(transport.close) == "function" then
                pcall(transport.close, transport)
            end
            log.error("vuart_v1_mem", "fail_closed", reason)
        end,
    })
    local function sample_memory()
        local healthy, snapshot = memory_monitor:sample()
        if snapshot then
            log.info("vuart_v1_mem", "sample",
                snapshot.lua_total, snapshot.lua_used, snapshot.lua_peak,
                snapshot.lua_free, snapshot.sys_total, snapshot.sys_used,
                snapshot.sys_peak, snapshot.sys_free)
            if runtime and type(runtime.metrics) == "function" then
                local link = runtime:metrics()
                log.info("vuart_v1_link", "ack",
                    link.link_acks_received or 0,
                    link.link_ack_duplicates or 0,
                    link.link_ack_out_of_order or 0,
                    link.link_ack_invalid or 0)
            end
        else
            log.error("vuart_v1_mem", "sample_invalid")
        end
        return healthy
    end

    if sample_memory() then
    transport = uart_module.new({
        uart_api = UART_API,
        sys_api = sys,
        uart_id = 1,
        baud_rate = 921600,
        rx_buffer_bytes = 16384,
        max_read_bytes = 16384,
        queue_limit = 8,
        on_bytes = function(bytes)
            if not runtime or not started then return end
            local called, message = pcall(runtime.ingest, runtime, bytes)
            if not called then
                runtime:quarantine()
                log.error("vuart_v1_prod", "ingest failed", tostring(message))
            end
        end,
    })
    local uplink = uplink_module.new({
        cc_api = CC_API,
        raw_codec = 0,
        capacity_chunks = 2,
        schedule = function(callback, delay_ms)
            sys.timerStart(callback, delay_ms)
        end,
    })
    carrier = cc_module.new({
        cc_api = CC_API,
        subscribe = function(topic, callback)
            sys.subscribe(topic, callback)
        end,
        sim_id = 0,
        zbuff_api = ZBUFF_API,
        enable_downlink = true,
        buffer_size = AUDIO_BUFFER_SIZE,
        uplink = uplink,
    })

    runtime = runtime_module.new({
        device_id = resolved_device_id,
        boot_id = resolved_boot_id,
        firmware_version = VERSION,
        capability_flags = CAPABILITY_FLAGS,
        max_payload_bytes = 8192,
        max_records = 128,
        now_ms = uptime_ms,
        uptime_ms = uptime_ms,
        write = function(bytes) return transport:write(bytes) end,
        carrier = carrier,
    })

    carrier:set_event_handler(function(carrier_state, carrier_cause)
        if not started then return end
        local called, message = pcall(runtime.carrier_event, runtime,
            carrier_state, carrier_cause)
        if not called then
            runtime:quarantine()
            log.error("vuart_v1_prod", "carrier event failed", tostring(message))
        end
    end)
    carrier:set_downlink_handler(function(pcm)
        if not started then return false end
        return runtime:audio_downlink(pcm)
    end)

    local function heartbeat()
        if not started then return end
        local called, message = pcall(runtime.heartbeat, runtime)
        if not called then
            runtime:quarantine()
            log.error("vuart_v1_prod", "heartbeat failed", tostring(message))
        end
    end

    carrier:set_ready_handler(function()
        if started then return end
        started = true
        local called, message = pcall(runtime.start, runtime)
        if not called then
            started = false
            runtime:quarantine()
            log.error("vuart_v1_prod", "runtime start failed", tostring(message))
            return
        end
        sys.timerLoopStart(heartbeat, HEARTBEAT_INTERVAL_MS)
        log.info("vuart_v1_prod", "READY", PROJECT, VERSION, rtos.version())
    end)

    local function initialize_audio()
        local called, result = pcall(exaudio.setup, AUDIO_CONFIG)
        if not called or result ~= true then
            runtime:quarantine()
            log.error("vuart_v1_prod", "audio setup failed")
            return
        end
        local mode_ok, mode = pcall(exaudio.get_audio_mode)
        if not mode_ok or mode ~= "audio_v2" then
            runtime:quarantine()
            log.error("vuart_v1_prod", "unexpected audio framework")
            return
        end
        carrier:set_audio_ready(true)
    end

    if transport:open() then
        sys.timerLoopStart(sample_memory, MEMORY_SAMPLE_INTERVAL_MS)
        sys.taskInit(initialize_audio)
    else
        runtime:quarantine()
        log.error("vuart_v1_prod", "VUART setup failed")
    end
    end
end

sys.run()
