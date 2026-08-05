import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { LuaFactory } from "wasmoon";
import { describe, expect, it } from "vitest";

const firmwareUrl = new URL(
  "../../../../firmware/air780-livekit-bridge/",
  import.meta.url,
);

const runtimeFiles = [
  "vuart_v1_codec.lua",
  "vuart_v1_cmd_codec.lua",
  "vuart_v1_stream.lua",
  "vuart_v1_ledger.lua",
  "vuart_v1_runtime.lua",
  "vuart_v1_uplink.lua",
  "vuart_v1_mock_cc.lua",
  "vuart_v1_prod_test.lua",
] as const;
const productionFiles = runtimeFiles.slice(0, 6);

describe("Air780 production Lua VUART v1 runtime", () => {
  it("keeps every runtime and test filename within the Luatools limit", () => {
    for (const file of [...runtimeFiles, "PROD_MANIFEST.sha256"]) {
      expect(Buffer.byteLength(file, "utf8"), file).toBeLessThanOrEqual(24);
    }
  });

  it("pins the production runtime core without mock or self-test files", () => {
    const manifest = readFileSync(
      new URL("PROD_MANIFEST.sha256", firmwareUrl),
      "utf8",
    );
    const entries = manifest.trim().split("\n").map((line) => {
      const match = line.match(/^([0-9a-f]{64})  ([A-Za-z0-9_.-]+)$/);
      expect(match).not.toBeNull();
      return { hash: match![1], file: match![2] };
    });
    expect(entries.map(({ file }) => file)).toEqual(productionFiles);
    for (const { file, hash } of entries) {
      expect(runtimeFiles).toContain(file);
      const source = readFileSync(new URL(file, firmwareUrl));
      expect(createHash("sha256").update(source).digest("hex"), file).toBe(hash);
    }
  });

  it("does not import the diagnostic text protocol or JSON", () => {
    for (const file of runtimeFiles) {
      const source = readFileSync(new URL(file, firmwareUrl), "utf8");
      expect(source, file).not.toContain("WJAI/1");
      expect(source, file).not.toMatch(/json\.(encode|decode)/);
      expect(source, file).not.toMatch(/require\s*\(\s*["']crypto["']\s*\)/);
    }
  });

  it("executes fragmentation, CRC, replay, fence, generation, and capacity tests", async () => {
    const factory = new LuaFactory();
    for (const file of runtimeFiles) {
      await factory.mountFile(
        `/firmware/${file}`,
        readFileSync(new URL(file, firmwareUrl)),
      );
    }
    const lua = await factory.createEngine();
    try {
      await lua.doString(`
        package.path = "/firmware/?.lua;" .. package.path
        local function crc32(value)
          local crc = 0xffffffff
          for index = 1, #value do
            crc = crc ~ value:byte(index)
            for _ = 1, 8 do
              local mask = -(crc & 1)
              crc = (crc >> 1) ~ (0xedb88320 & mask)
            end
          end
          return (~crc) & 0xffffffff
        end
        local function lossless_test_signature(value)
          return (value:gsub(".", function(byte)
            return string.format("%02x", byte:byte())
          end))
        end
        crypto = { crc32 = crc32, sha256 = lossless_test_signature }
      `);
      const result = await lua.doString(`
        local suite = require("vuart_v1_prod_test")
        local result = suite.run()
        if type(result) ~= "table" or result.ok ~= true then
          error("production runtime suite returned no PASS result")
        end
        return result.status
      `);
      expect(result).toBe("PURE_SOFTWARE_PASS");
    } finally {
      lua.global.close();
    }
  });
});
