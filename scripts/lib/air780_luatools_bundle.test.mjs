import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseAir780FlashManifest,
  prepareAir780LuatoolsBundle,
} from "./air780_luatools_bundle.mjs";

describe("Air780 Luatools bundle", () => {
  it("copies only hash-pinned production Lua files into an empty directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "air780-source-"));
    const output = await mkdtemp(join(tmpdir(), "air780-output-"));
    const bytes = Buffer.from("return { ok = true }\n");
    const hash = createHash("sha256").update(bytes).digest("hex");
    await writeFile(join(root, "runtime.lua"), bytes);
    await writeFile(
      join(root, "PROD_FLASH_MANIFEST.tsv"),
      `${hash}\truntime.lua\truntime.lua\n`,
    );

    const summary = await prepareAir780LuatoolsBundle({
      firmwareRoot: root,
      outputDirectory: output,
    });

    expect(summary).toMatchObject({ fileCount: 1,
      files: [{ target: "runtime.lua", hash }] });
    expect(await readFile(join(output, "runtime.lua"), "utf8"))
      .toBe(bytes.toString("utf8"));
  });

  it("rejects test files, long targets, duplicate targets, and hash drift", async () => {
    const hash = "0".repeat(64);
    expect(() => parseAir780FlashManifest(
      `${hash}\tvuart_test.lua\tvuart_test.lua\n`,
    )).toThrow("unsafe");
    expect(() => parseAir780FlashManifest(
      `${hash}\truntime.lua\tvuart_v1_command_codec.lua\n`,
    )).toThrow("24 bytes");
    expect(() => parseAir780FlashManifest(
      `${hash}\tone.lua\truntime.lua\n${hash}\ttwo.lua\truntime.lua\n`,
    )).toThrow("duplicated");

    const root = await mkdtemp(join(tmpdir(), "air780-drift-"));
    const output = join(root, "..", `air780-out-${Date.now()}`);
    await writeFile(join(root, "runtime.lua"), "return true\n");
    await writeFile(join(root, "PROD_FLASH_MANIFEST.tsv"),
      `${hash}\truntime.lua\truntime.lua\n`);
    await expect(prepareAir780LuatoolsBundle({ firmwareRoot: root,
      outputDirectory: output })).rejects.toThrow("hash mismatch");
  });
});
