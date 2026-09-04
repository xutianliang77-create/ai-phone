local M = {}
local crypto = rawget(_G, "crypto")

local function require_value(condition, message)
    if not condition then error("vuart_v1_ledger: " .. message, 0) end
end

function M.signature(frame_type, payload)
    require_value(type(frame_type) == "number" and frame_type >= 0
        and frame_type <= 255 and frame_type == math.floor(frame_type),
        "frame_type must be uint8")
    require_value(type(payload) == "string", "payload must be binary string")
    require_value(crypto and type(crypto.sha256) == "function",
        "crypto.sha256 unavailable")
    return crypto.sha256(string.char(frame_type) .. payload):lower()
end

function M.new(options)
    options = options or {}
    local max_records = options.max_records or 128
    require_value(type(max_records) == "number" and max_records >= 1
        and max_records == math.floor(max_records),
        "max_records must be a positive integer")
    local state = {
        max_records = max_records,
        size = 0,
        records = {},
        owners = {},
    }

    function state:lookup(command_id, idempotency_key, signature)
        local record = self.records[command_id]
        if record then
            if record.idempotency_key == idempotency_key
                and record.signature == signature then
                return "replay", record.reply
            end
            return "conflict"
        end
        local owner = self.owners[idempotency_key]
        if owner and owner ~= command_id then return "conflict" end
        if self.size >= self.max_records then return "full" end
        return "new"
    end

    function state:store(command_id, idempotency_key, signature, reply)
        require_value(self.records[command_id] == nil, "command already stored")
        require_value(self.owners[idempotency_key] == nil,
            "idempotency key already stored")
        require_value(self.size < self.max_records, "ledger is full")
        require_value(type(reply) == "string", "reply must be binary string")
        self.records[command_id] = {
            idempotency_key = idempotency_key,
            signature = signature,
            reply = reply,
        }
        self.owners[idempotency_key] = command_id
        self.size = self.size + 1
    end

    function state:metrics()
        return { records = self.size, max_records = self.max_records }
    end

    return state
end

return M
