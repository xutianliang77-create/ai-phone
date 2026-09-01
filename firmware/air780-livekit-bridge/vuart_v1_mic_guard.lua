local M = {}
local PROBE_VOLUME = 10

local function write_volume(set_volume, value, reason)
    local called, accepted = pcall(set_volume, value)
    if not called or accepted ~= true then return false, reason end
    return true
end

local function read_volume(get_volume, i2c_id)
    local called, value = pcall(get_volume, i2c_id)
    return called and type(value) == "number" and value or nil
end

function M.mute(options)
    if type(options) ~= "table"
        or type(options.set_volume) ~= "function"
        or type(options.get_volume) ~= "function"
        or (options.i2c_id ~= 0 and options.i2c_id ~= 1) then
        return false, "api_unavailable"
    end

    local written, reason = write_volume(
        options.set_volume, PROBE_VOLUME, "probe_write_failed")
    if not written then return false, reason end
    local probe = read_volume(options.get_volume, options.i2c_id)
    if not probe or probe < PROBE_VOLUME - 1 or probe > PROBE_VOLUME then
        return false, "probe_readback_failed"
    end

    written, reason = write_volume(
        options.set_volume, 0, "mute_write_failed")
    if not written then return false, reason end
    local muted = read_volume(options.get_volume, options.i2c_id)
    if muted ~= 0 then return false, "mute_readback_failed" end

    return true, {
        probe_readback = probe,
        muted_readback = muted,
    }
end

return M
