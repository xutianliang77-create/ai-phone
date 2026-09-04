PROJECT = "WUJIE_AIR_GATE0B_STREAM"
VERSION = "000.004.000"

local UART_ID = uart.VUART_0
local WATCHDOG_PIN = 24
local WATCHDOG_FEED_INTERVAL_MS = 10000
local STREAM_PUMP_INTERVAL_MS = 10
local REQUIRED_CORE_VERSION = 2048
local MAX_COMMAND_BYTES = 128
local air153C_wtd = require("air153C_wtd")
local exaudio = require("exaudio")
local raw_controller = require("g0b_raw")

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

local command_buffer = ""
local frame_sequence = 0
local call_generation = 0
local incoming_call = false
local call_control_busy = false
local audio_generation_open = false
local audio_started = false
local cc_ready = false
local cc_initialized = false
local audio_setup_done = false
local audio_setup_ok = false
local controller = nil
local last_reported_failure_count = 0

local function tick_now()
    local high, low = mcu.ticks2(1)
    return high * 1000000 + low
end

local function feed_external_watchdog()
    air153C_wtd.feed_dog(WATCHDOG_PIN)
end

air153C_wtd.init(WATCHDOG_PIN)
feed_external_watchdog()
sys.timerLoopStart(feed_external_watchdog, WATCHDOG_FEED_INTERVAL_MS)

local function emit(kind, value)
    local payload = json.encode(value or {})
    frame_sequence = frame_sequence + 1
    local header = string.format("WJG0B/1 %s %d %d\n",
        kind, #payload, frame_sequence)
    local written = uart.write(UART_ID, header .. payload)
    if not written or written <= 0 then
        log.error("gate0b", "VUART write failed", kind)
    end
end

local function safe_value(fn)
    if type(fn) ~= "function" then return nil end
    local ok, value = pcall(fn)
    return ok and value or nil
end

local function detected_core_version()
    local firmware = safe_value(rtos.version)
    if type(firmware) ~= "string" then return nil end
    return tonumber(firmware:match("[Vv](%d+)"))
end

local function stream_capability()
    local core_version = detected_core_version()
    if not core_version or core_version < 2048 then
        return false, "requires_v2048", core_version
    end
    if not audio_v2 or audio_v2.DATA_CODEC_TYPE_RAW ~= 0 then
        return false, "raw_codec_must_be_zero", core_version
    end
    if type(cc.extern_source) ~= "function" or type(cc.input) ~= "function" then
        return false, "cc_stream_api_unavailable", core_version
    end
    return true, "ready", core_version
end

local function controller_stats()
    return controller and controller:stats() or {active = false}
end

local function emit_info(reason)
    local supported, support_reason, core_version = stream_capability()
    emit("INFO", {
        reason = reason,
        project = PROJECT,
        app_version = VERSION,
        firmware = safe_value(rtos.version),
        core_version = core_version,
        required_core_version = REQUIRED_CORE_VERSION,
        bsp = safe_value(rtos.bsp),
        cc_ready = cc_ready,
        cc_initialized = cc_initialized,
        cc_stream_supported = supported,
        cc_stream_reason = support_reason,
        string_input_only = true,
        audio_setup_done = audio_setup_done,
        audio_setup_ok = audio_setup_ok,
        audio_mode_requested = "new",
        audio_mode_actual = safe_value(exaudio.get_audio_mode),
        call_generation = call_generation,
        incoming_call = incoming_call,
        call_control_busy = call_control_busy,
        dial_supported = type(cc.dial) == "function",
        audio_generation_open = audio_generation_open,
        audio_started = audio_started,
        chunk_size = 6400,
        sample_rate = 16000,
        supported_call_qualities = {1, 2},
        controller = controller_stats(),
    })
end

local function build_controller()
    local supported, reason, core_version = stream_capability()
    if not supported then
        emit("ERROR", {
            operation = "cc_stream_capability",
            reason = reason,
            core_version = core_version,
        })
        return false
    end
    local created, value = pcall(raw_controller.new, {
        cc_api = {
            extern_source = function(...)
                return cc.extern_source(...)
            end,
            input = function(...)
                return cc.input(...)
            end,
        },
        raw_codec = audio_v2.DATA_CODEC_TYPE_RAW,
        now_ms = tick_now,
    })
    if not created then
        emit("ERROR", {operation = "controller_create", reason = tostring(value)})
        return false
    end
    controller = value
    return true
end

local function maybe_initialize_cc(trigger)
    if cc_initialized or not cc_ready or not audio_setup_ok then return end
    if not build_controller() then return end
    local called, result = pcall(cc.init, 0)
    if not called or result ~= true then
        controller = nil
        emit("ERROR", {operation = "cc_init", trigger = trigger})
        return
    end
    cc_initialized = true
    emit("READY", {operation = "cc_init", trigger = trigger})
end

local function initialize_audio()
    if audio_setup_done then return end
    audio_setup_done = true
    local called, result = pcall(exaudio.setup, AUDIO_CONFIG)
    audio_setup_ok = called and result == true
        and safe_value(exaudio.get_audio_mode) == "audio_v2"
    if not audio_setup_ok then
        emit("ERROR", {operation = "audio_setup", reason = tostring(result)})
        return
    end
    maybe_initialize_cc("audio_setup")
end

local function cancel_source(reason)
    if not controller then return end
    local cleared = controller:clear(reason)
    emit("CLEAR", {
        reason = reason,
        accepted = cleared,
        controller = controller:stats(),
    })
end

local function pump_stream()
    if not controller or not audio_started then return end
    local before = controller:stats()
    if not before.active then return end
    local ok = controller:pump(call_generation)
    local after = controller:stats()
    local failures = after.input_failures + after.end_failures
        + after.stop_failures
    if not ok and failures > last_reported_failure_count then
        last_reported_failure_count = failures
        emit("ERROR", {
            operation = "stream_pump",
            call_generation = call_generation,
            controller = after,
        })
    end
end

sys.timerLoopStart(pump_stream, STREAM_PUMP_INTERVAL_MS)

sys.subscribe("CC_IND", function(status)
    if status == "READY" then
        cc_ready = true
        maybe_initialize_cc("cc_ready")
    elseif status == "INCOMINGCALL" then
        incoming_call = true
        call_control_busy = true
    elseif status == "AUDIO_START" and not audio_generation_open then
        audio_generation_open = true
        call_generation = call_generation + 1
        audio_started = controller ~= nil
            and controller:begin_call(call_generation, cc.quality())
        last_reported_failure_count = 0
    elseif status == "EXT_SRC_DONE" then
        local completed = controller
            and controller:on_ext_src_done(call_generation) or false
        emit("DONE", {completed = completed, controller = controller_stats()})
    elseif status == "MAKE_CALL_FAILED" or status == "DISCONNECTED"
        or status == "HANGUP_CALL_DONE" then
        cancel_source(status)
        incoming_call = false
        call_control_busy = false
        audio_generation_open = false
        audio_started = false
    end
    emit("CC_EVENT", {
        status = status,
        quality = safe_value(cc.quality),
        call_generation = call_generation,
    })
end)

local function reply(command, ok, detail)
    emit(ok and "REPLY" or "ERROR", {
        command = command,
        ok = ok,
        detail = detail,
        controller = controller_stats(),
    })
end

local function handle_command(line)
    line = line:gsub("\r$", "")
    if line == "" then return end
    local upper = line:upper()
    if upper == "PING" then
        reply(line, true, "PONG")
    elseif upper == "INFO" or upper == "STATS" then
        emit_info(upper)
    elseif upper == "SELFTEST" then
        local supported = stream_capability()
        local idle = not incoming_call and not call_control_busy
            and not audio_generation_open
            and not audio_started and not controller_stats().active
        local ok = supported and type(cc.dial) == "function"
            and cc_initialized and controller ~= nil and idle
        reply(line, ok, ok and "V2048 CC string stream ready"
            or "stream capability or idle-state check failed")
    elseif upper:match("^DIAL%s+") then
        local target = upper:match("^DIAL%s+(%d+)$")
        local valid = target and #target >= 3 and #target <= 20
        local idle = not call_control_busy and not incoming_call
            and not audio_generation_open and not audio_started
            and not controller_stats().active
        local called, result = false, false
        if valid and idle and cc_initialized and type(cc.dial) == "function" then
            called, result = pcall(cc.dial, 0, target)
        end
        local ok = called and result == true
        if ok then call_control_busy = true end
        reply("DIAL", ok, ok and "dial request accepted"
            or "invalid state, target, or provider result")
    elseif upper == "ANSWER" then
        local ok = cc_initialized and incoming_call and cc.accept(0) == true
        reply(line, ok, "explicit incoming call answer")
    elseif upper == "HANGUP" then
        cancel_source("host_hangup")
        local called = cc_initialized and pcall(cc.hangUp, 0)
        reply(line, called == true, "hangup requested")
    elseif upper == "CLEAR" then
        local ok = controller and controller:clear("host") or false
        reply(line, ok, ok and "cleared" or "stop pending; no refill")
    else
        local count = tonumber(upper:match("^START%s+(%d+)$"))
        local ok = count and audio_started and controller:start(count) or false
        reply(line, ok == true, ok and "finite raw stream started"
            or "invalid state or chunk count")
    end
end

local function uart_receive(id, len)
    local chunk = uart.read(id, len or 1024)
    if not chunk or #chunk == 0 then return end
    command_buffer = command_buffer .. chunk
    while true do
        local newline = command_buffer:find("\n", 1, true)
        if not newline then break end
        handle_command(command_buffer:sub(1, newline - 1))
        command_buffer = command_buffer:sub(newline + 1)
    end
    if #command_buffer > MAX_COMMAND_BYTES then
        command_buffer = ""
        reply("INVALID", false, "command too long")
    end
end

local setup_result = uart.setup(UART_ID, 115200, 8, 1)
uart.on(UART_ID, "receive", uart_receive)
log.info("gate0b", PROJECT, VERSION, "VUART", setup_result)
sys.taskInit(initialize_audio)
sys.timerStart(function() emit_info("boot") end, 1500)
sys.run()
