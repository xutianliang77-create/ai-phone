import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { archiveIosSymbols, parseDwarfUuids, verifyIosSymbolArchive } from "./archive_ios_candidate_symbols.mjs";

const roots = [];
const runnerUuid = "AB73E3B1-D65F-3119-B146-A369DCD02192";
const appUuid = "8228BCF3-F2A6-6EBA-A30D-B0EB3A16F414";
const readUuids = file => JSON.parse(readFileSync(file, "utf8")).uuids;
function writeObject(file, uuids, content = "fixture") {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ uuids, content }));
}
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "wujie-symbols-"));
  roots.push(root);
  const app = path.join(root, "Runner.app"), source = path.join(root, "Profile-iphoneos"), output = path.join(root, "Symbols");
  const runnerDwarf = "Runner.app.dSYM/Contents/Resources/DWARF/Runner";
  const appDwarf = "App.framework.dSYM/Contents/Resources/DWARF/App";
  writeObject(path.join(app, "Runner"), [{ architecture: "arm64", uuid: runnerUuid }]);
  writeObject(path.join(app, "Frameworks/App.framework/App"), [{ architecture: "arm64", uuid: appUuid }]);
  writeObject(path.join(source, runnerDwarf), [{ architecture: "arm64", uuid: runnerUuid }]);
  writeObject(path.join(source, appDwarf), [{ architecture: "arm64", uuid: appUuid }]);
  return { root, app, source, output, runnerDwarf, appDwarf };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("exact iOS candidate symbols", () => {
  it("parses all architectures, sorts them and rejects invalid or duplicate UUID output", () => {
    expect(parseDwarfUuids(`UUID: ${runnerUuid.toLowerCase()} (x86_64) /a b/Runner\nUUID: ${appUuid} (arm64) /a b/Runner\n`))
      .toEqual([{ architecture: "arm64", uuid: appUuid }, { architecture: "x86_64", uuid: runnerUuid }]);
    for (const text of ["", "error reading symbols", `UUID: invalid (arm64) /file`]) {
      expect(() => parseDwarfUuids(text)).toThrow("ios_symbols_uuid_output_invalid");
    }
    expect(() => parseDwarfUuids(`UUID: ${runnerUuid} (arm64) /file\nUUID: ${appUuid} (arm64) /file`))
      .toThrow("ios_symbols_duplicate_architecture");
  });

  it("copies both matching dSYMs, rechecks copied bytes and writes a verifiable portable manifest", () => {
    const f = setup();
    const result = archiveIosSymbols(f.app, f.source, f.output, { readUuids });
    expect(result.status).toBe("UUID_MATCHED");
    expect(result.components.map(component => component.name)).toEqual(["Runner", "App"]);
    expect(result.components.every(component => /^[a-f0-9]{64}$/u.test(component.dwarfSha256))).toBe(true);
    expect(readFileSync(path.join(f.output, f.runnerDwarf))).toEqual(readFileSync(path.join(f.source, f.runnerDwarf)));
    expect(JSON.stringify(result)).not.toContain(f.root);
    const verification = verifyIosSymbolArchive(f.app, f.output, readUuids);
    expect(verification).toMatchObject({ status: "UUID_MATCHED", manifest: "Symbols/manifest.json" });
    expect(verification.manifestSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects a same-source rebuild with a different Runner UUID before copying", () => {
    const f = setup();
    writeObject(path.join(f.source, f.runnerDwarf), [{ architecture: "arm64", uuid: "BDE0E6F0-278D-3DB7-8A4F-463671F4FA29" }]);
    expect(() => archiveIosSymbols(f.app, f.source, f.output, { readUuids })).toThrow("ios_symbols_uuid_mismatch:Runner");
    expect(existsSync(f.output)).toBe(false);
  });

  it("requires matching App UUID and complete architecture coverage", () => {
    const f = setup();
    writeObject(path.join(f.source, f.appDwarf), [{ architecture: "arm64", uuid: runnerUuid }]);
    expect(() => archiveIosSymbols(f.app, f.source, f.output, { readUuids })).toThrow("ios_symbols_uuid_mismatch:App");
    writeObject(path.join(f.source, f.appDwarf), [{ architecture: "x86_64", uuid: appUuid }]);
    expect(() => archiveIosSymbols(f.app, f.source, f.output, { readUuids })).toThrow("ios_symbols_uuid_mismatch:App");
    expect(existsSync(f.output)).toBe(false);
  });

  it.each(["runnerDwarf", "appDwarf"])("does not publish an archive when %s is missing", key => {
    const f = setup();
    rmSync(path.join(f.source, f[key]));
    expect(() => archiveIosSymbols(f.app, f.source, f.output, { readUuids })).toThrow();
    expect(existsSync(f.output)).toBe(false);
  });

  it("never replaces an existing or partial symbol archive", () => {
    const f = setup();
    mkdirSync(f.output);
    writeFileSync(path.join(f.output, "prior.txt"), "preserve this prior attempt");
    expect(() => archiveIosSymbols(f.app, f.source, f.output, { readUuids })).toThrow();
    expect(readFileSync(path.join(f.output, "prior.txt"), "utf8")).toBe("preserve this prior attempt");
    expect(existsSync(path.join(f.output, "manifest.json"))).toBe(false);
  });

  it("keeps a failed copy for diagnosis without issuing a success manifest", () => {
    const f = setup();
    const copy = (from, to, options) => {
      cpSync(from, to, options);
      if (to.endsWith("Runner.app.dSYM")) {
        writeObject(path.join(to, "Contents/Resources/DWARF/Runner"), [{ architecture: "arm64", uuid: runnerUuid }], "corrupted same UUID");
      }
    };
    expect(() => archiveIosSymbols(f.app, f.source, f.output, { readUuids, copy })).toThrow("ios_symbols_archive_changed");
    expect(existsSync(path.join(f.output, "manifest.json"))).toBe(false);
  });

  it.each(["binary", "symbols", "manifest"])("detects later changes to %s instead of trusting a status flag", key => {
    const f = setup();
    archiveIosSymbols(f.app, f.source, f.output, { readUuids });
    if (key === "manifest") {
      writeFileSync(path.join(f.output, "manifest.json"), JSON.stringify({ status: "UUID_MATCHED" }));
    } else {
      writeObject(key === "binary" ? path.join(f.app, "Runner") : path.join(f.output, f.runnerDwarf),
        [{ architecture: "arm64", uuid: runnerUuid }], "changed bytes, unchanged UUID");
    }
    expect(() => verifyIosSymbolArchive(f.app, f.output, readUuids)).toThrow("ios_symbols_manifest_mismatch");
  });
});
