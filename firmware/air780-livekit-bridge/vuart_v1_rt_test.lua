local session_selftest = require("vuart_v1_golden_test")
local command_selftest = require("vuart_v1_cmd_test")

local M = {}

local function run_suite(operation)
    local called, result = pcall(operation)
    if not called then
        return { ok = false, error = tostring(result) }
    end
    if type(result) ~= "table" or result.ok ~= true then
        return { ok = false, error = "suite returned no PASS result" }
    end
    return { ok = true, schema = result.schema }
end

function M.run()
    local session = run_suite(session_selftest.run)
    local command = run_suite(command_selftest.run)
    return {
        ok = session.ok and command.ok,
        session = session,
        command = command,
    }
end

return M
