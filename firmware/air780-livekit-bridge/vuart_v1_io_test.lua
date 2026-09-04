local uart_module = require("vuart_v1_uart")
local cc_module = require("vuart_v1_cc")
local uplink_module = require("vuart_v1_uplink")

local M = {}

local function assert_equal(actual, expected, name)
    if actual ~= expected then
        error(string.format("%s mismatch: expected=%s actual=%s",
            name, tostring(expected), tostring(actual)), 0)
    end
end

local function assert_uart_transport()
    local reads = { "abc", "def" }
    local limits = { 2, 0, 99 }
    local received, transmitted, timers = {}, {}, {}
    local callback
    local uart_api = {
        setup = function(id, baud, bits, stop, parity, order, buffer_bytes)
            assert_equal(id, 7, "UART id")
            assert_equal(baud, 921600, "UART baud")
            assert_equal(bits, 8, "UART bits")
            assert_equal(stop, 1, "UART stop bits")
            assert_equal(parity, nil, "UART default parity")
            assert_equal(order, nil, "UART default bit order")
            assert_equal(buffer_bytes, 16384, "UART RX buffer")
            return 0
        end,
        on = function(_, event, value)
            assert_equal(event, "receive", "UART event")
            callback = value
        end,
        read = function()
            return table.remove(reads, 1) or ""
        end,
        write = function(_, value)
            local accepted = math.min(table.remove(limits, 1) or #value, #value)
            if accepted > 0 then
                transmitted[#transmitted + 1] = value:sub(1, accepted)
            end
            return accepted
        end,
        close = function() end,
    }
    local transport = uart_module.new({
        uart_api = uart_api,
        sys_api = { timerStart = function(fn) timers[#timers + 1] = fn end },
        uart_id = 7,
        baud_rate = 921600,
        rx_buffer_bytes = 16384,
        on_bytes = function(value) received[#received + 1] = value end,
    })
    assert_equal(transport:open(), true, "UART open")
    callback(7, 6)
    assert_equal(table.concat(received), "abcdef", "UART RX bytes")
    assert_equal(transport:write("uvwxyz"), true, "UART enqueue")
    assert_equal(table.concat(transmitted), "uv", "UART partial write")
    assert_equal(#timers, 1, "UART retry timer")
    table.remove(timers, 1)()
    assert_equal(table.concat(transmitted), "uvwxyz", "UART exact TX bytes")
    local metrics = transport:metrics()
    assert_equal(metrics.rx_bytes, 6, "UART RX metric")
    assert_equal(metrics.tx_completed, 1, "UART TX completion")
    assert_equal(metrics.tx_zero_or_error, 1, "UART zero write metric")
    transport:close()
    assert_equal(transport:write("late"), false, "closed UART write")

    local blocked_timers = {}
    local blocked = uart_module.new({
        uart_api = {
            setup = function() return 0 end,
            on = function() end,
            read = function() return "" end,
            write = function() return 0 end,
            close = function() end,
        },
        sys_api = { timerStart = function(fn)
            blocked_timers[#blocked_timers + 1] = fn
        end },
        uart_id = 8,
        queue_limit = 2,
        on_bytes = function() end,
    })
    assert_equal(blocked:open(), true, "blocked UART open")
    assert_equal(blocked:write("one"), true, "first bounded frame")
    assert_equal(blocked:write("two"), true, "second bounded frame")
    assert_equal(blocked:write("three"), false, "bounded drop")
    assert_equal(blocked:metrics().queue_depth, 2, "bounded queue depth")
    assert_equal(blocked:metrics().tx_dropped, 1, "bounded drop metric")

    local failed = uart_module.new({
        uart_api = { setup = function() return -1 end },
        sys_api = { timerStart = function() end },
        uart_id = 10,
        on_bytes = function() end,
    })
    assert_equal(failed:open(), false, "UART setup failure")
end

local function assert_cc_adapter()
    local subscription, record_callback
    local init_calls, dial_calls, hangup_calls = 0, 0, 0
    local record_start_calls, record_stop_calls = 0, 0
    local dial_ok, hangup_error = true, false
    local ready_calls, downlink_frames = 0, 0
    local now_ms = 0
    local events, buffers = {}, {}
    local cc_api = {
        init = function(sim_id)
            assert_equal(sim_id, 0, "cc init SIM")
            init_calls = init_calls + 1
            return true
        end,
        on = function(event, callback)
            assert_equal(event, "record", "cc record event")
            record_callback = callback
        end,
        record = function(enabled, up1, up2, down1, down2)
            if not enabled then
                record_stop_calls = record_stop_calls + 1
                return true
            end
            if not up1 or not up2 or not down1 or not down2 then
                error("cc record buffers missing", 0)
            end
            record_start_calls = record_start_calls + 1
            return true
        end,
        quality = function() return 2 end,
        dial = function(sim_id, number)
            assert_equal(sim_id, 0, "cc dial SIM")
            assert_equal(number, "+8613800138000", "cc dial target")
            dial_calls = dial_calls + 1
            return dial_ok
        end,
        hangUp = function(sim_id)
            assert_equal(sim_id, 0, "cc hangup SIM")
            if hangup_error then error("mock hangup failed", 0) end
            hangup_calls = hangup_calls + 1
        end,
        extern_source = function() return true end,
        input = function(_, value) return true, #value, 6400 end,
    }
    local zbuff_api = {
        HEAP_AUTO = 1,
        create = function(size)
            assert_equal(size, 6400, "cc zbuff size")
            local buffer = { value = "" }
            function buffer:used(value)
                if value ~= nil then
                    if value == 0 then self.value = "" end
                    return value
                end
                return #self.value
            end
            function buffer:query() return self.value end
            function buffer:seek() return true end
            buffers[#buffers + 1] = buffer
            return buffer
        end,
    }
    local uplink = uplink_module.new({
        cc_api = cc_api,
        now_ms = function() return now_ms end,
        raw_codec = 0,
        schedule = function() end,
    })
    local adapter = cc_module.new({
        cc_api = cc_api,
        now_ms = function() return now_ms end,
        subscribe = function(topic, callback)
            assert_equal(topic, "CC_IND", "cc subscription")
            subscription = callback
        end,
        zbuff_api = zbuff_api,
        enable_downlink = true,
        uplink = uplink,
        on_ready = function() ready_calls = ready_calls + 1 end,
        on_event = function(carrier_state, carrier_cause)
            events[#events + 1] = carrier_state .. ":" .. carrier_cause
        end,
        on_downlink = function(pcm)
            assert_equal(#pcm, 6400, "cc downlink bytes")
            downlink_frames = downlink_frames + 1
            return true
        end,
    })

    adapter:set_audio_ready(true)
    assert_equal(init_calls, 0, "cc waits for READY")
    subscription("READY")
    subscription("READY")
    assert_equal(init_calls, 1, "cc init exactly once")
    assert_equal(record_start_calls, 0, "cc record waits for active call audio")
    assert_equal(ready_calls, 1, "cc ready exactly once")
    assert_equal(#buffers, 4, "cc double buffers")

    local dial = adapter.dial({
        dial_target_e164 = "+8613800138000", call_generation = 1,
    })
    assert_equal(dial.status, "applied", "cc dial status")
    assert_equal(adapter.dial({
        dial_target_e164 = "+8613800138000", call_generation = 1,
    }).status,
        "rejected", "cc duplicate dial")
    subscription("MAKE_CALL_OK")
    now_ms = 10
    subscription("CONNECTED")
    now_ms = 20
    subscription("SPEECH_START")
    assert_equal(#events, 1, "cc waits for AUDIO_START before connected")
    now_ms = 30
    subscription("AUDIO_START")
    now_ms = 31
    subscription("AUDIO_START")
    local started_metrics = adapter:metrics()
    assert_equal(started_metrics.record_started_ms, 30, "cc record start time")
    assert_equal(started_metrics.media_started_ms, 30, "cc media start time")
    assert_equal(events[1], "dialing:none", "cc dialing event")
    assert_equal(events[2], "connected:none", "cc connected event")
    assert_equal(#events, 2, "cc connected dedupe")
    assert_equal(adapter.is_connected(), true, "cc connected authority")

    buffers[3].value = string.rep("d", 6400)
    assert_equal(record_start_calls, 1, "cc record starts on AUDIO_START")
    record_callback(true, 1)
    assert_equal(downlink_frames, 1, "cc downlink delivery")
    assert_equal(buffers[3]:used(), 0, "cc downlink buffer cleared")
    buffers[1].value = string.rep("u", 6400)
    record_callback(false, 1)
    assert_equal(downlink_frames, 1, "cc raw uplink isolation")
    assert_equal(buffers[1]:used(), 0, "cc uplink buffer cleared")
    assert_equal(adapter.dtmf({ digits = "1" }).error_code,
        "unsupported_command", "cc DTMF boundary")

    assert_equal(adapter.hangup({}).status, "applied", "cc hangup status")
    assert_equal(adapter.hangup({}).status, "rejected", "cc duplicate hangup")
    subscription("DISCONNECTED")
    subscription("HANGUP_CALL_DONE")
    assert_equal(record_stop_calls, 1, "cc record stops on terminal")
    assert_equal(events[3], "disconnected:local_hangup", "cc terminal event")
    assert_equal(#events, 3, "cc terminal dedupe")
    assert_equal(hangup_calls, 1, "cc hangup exactly once")

    assert_equal(adapter.dial({
        dial_target_e164 = "+8613800138000", call_generation = 2,
    }).status,
        "applied", "cc next call")
    subscription("MAKE_CALL_FAILED")
    assert_equal(events[4], "failed:network_error", "cc failed event")
    subscription("INCOMINGCALL")
    assert_equal(#events, 4, "cc incoming call isolation")
    assert_equal(dial_calls, 2, "cc dial effects")
    dial_ok = false
    assert_equal(adapter.dial({
        dial_target_e164 = "+8613800138000", call_generation = 3,
    }).error_code,
        "internal_error", "cc synchronous dial failure")
    dial_ok = true
    assert_equal(adapter.dial({
        dial_target_e164 = "+8613800138000", call_generation = 3,
    }).status,
        "applied", "cc dial before hangup failure")
    hangup_error = true
    assert_equal(adapter.hangup({}).error_code, "internal_error",
        "cc synchronous hangup failure")
    local metrics = adapter:metrics()
    assert_equal(metrics.downlink_frames, 1, "cc downlink metric")
    assert_equal(metrics.uplink_discarded, 1, "cc uplink discard metric")
    assert_equal(metrics.audio_start_events, 2, "cc AUDIO_START metric")
    assert_equal(metrics.record_start_attempts, 1, "cc record attempt metric")
    assert_equal(metrics.record_starts, 1, "cc record start metric")
    assert_equal(metrics.record_callbacks, 2, "cc record callback metric")
    assert_equal(metrics.record_stops, 1, "cc record stop metric")
    assert_equal(metrics.uplink.source_starts, 1, "cc source start exactly once")
end

function M.run()
    assert_uart_transport()
    assert_cc_adapter()
    return { ok = true, status = "PRODUCTION_IO_HOST_PASS" }
end

return M
