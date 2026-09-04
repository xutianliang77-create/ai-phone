PROJECT = "WUJIE_AIR_VUART_V1_SELFTEST"
VERSION = "001.001.000"

local WATCHDOG_PIN = 24
local WATCHDOG_FEED_INTERVAL_MS = 10000
local air153C_wtd = require("air153C_wtd")
local runtime_selftest = require("vuart_v1_rt_test")

local function feed_external_watchdog()
    air153C_wtd.feed_dog(WATCHDOG_PIN)
end

air153C_wtd.init(WATCHDOG_PIN)
feed_external_watchdog()
sys.timerLoopStart(feed_external_watchdog, WATCHDOG_FEED_INTERVAL_MS)

local function log_suite(name, result)
    if result.ok then
        log.info("vuart_v1_selftest", name, "PASS", result.schema)
    else
        log.error("vuart_v1_selftest", name, "FAIL", result.error)
    end
end

local function run_selftest()
    log.info("vuart_v1_selftest", "BEGIN", PROJECT, VERSION, rtos.version())
    local called, result = pcall(runtime_selftest.run)
    if not called then
        log.error("vuart_v1_selftest", "FINAL", "FAIL", tostring(result))
        return
    end
    log_suite("SESSION", result.session)
    log_suite("COMMAND", result.command)
    log.info("vuart_v1_selftest", "FINAL", result.ok and "PASS" or "FAIL")
end

sys.taskInit(run_selftest)
sys.run()
