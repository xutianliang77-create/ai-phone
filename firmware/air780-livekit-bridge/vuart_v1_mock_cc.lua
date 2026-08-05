local M = {}

function M.new()
    local state = "ready"
    local counters = { dial = 0, hangup = 0, dtmf = 0,
        audio_uplink = 0, uplink_stops = 0 }

    return {
        dial = function(_command)
            if state ~= "ready" then
                return { status = "rejected", error_code = "invalid_state" }
            end
            counters.dial = counters.dial + 1
            state = "dialing"
            return { status = "applied" }
        end,
        hangup = function(_command)
            if state == "ready" then
                return { status = "rejected", error_code = "invalid_state" }
            end
            counters.hangup = counters.hangup + 1
            state = "disconnecting"
            return { status = "applied" }
        end,
        dtmf = function(_command)
            if state ~= "connected" then
                return { status = "rejected", error_code = "invalid_state" }
            end
            counters.dtmf = counters.dtmf + 1
            return { status = "applied" }
        end,
        audio_uplink = function(pcm, media_sequence, generation)
            if state ~= "connected" or type(pcm) ~= "string"
                or #pcm ~= 6400 or type(media_sequence) ~= "number"
                or type(generation) ~= "number" then return false end
            counters.audio_uplink = counters.audio_uplink + 1
            return true
        end,
        stop_uplink = function(_generation)
            counters.uplink_stops = counters.uplink_stops + 1
            return true
        end,
        is_connected = function() return state == "connected" end,
        set_state = function(value) state = value end,
        snapshot = function()
            return {
                state = state,
                dial = counters.dial,
                hangup = counters.hangup,
                dtmf = counters.dtmf,
                audio_uplink = counters.audio_uplink,
                uplink_stops = counters.uplink_stops,
            }
        end,
    }
end

return M
