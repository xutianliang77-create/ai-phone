import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Archive the symbols of these exact binaries, not a later same-source build.
const components = [
  { name: "Runner", binary: "Runner", dsym: "Runner.app.dSYM" },
  { name: "App", binary: "Frameworks/App.framework/App", dsym: "App.framework.dSYM" },
];
const sha256 = file => createHash("sha256").update(readFileSync(file)).digest("hex");

export function parseDwarfUuids(output) {
  const rows = output.trim().split(/\r?\n/).map(line => {
    const match = /^UUID: ([A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}) \(([^\s)]+)\) .+$/u.exec(line);
    if (!match) throw Error("ios_symbols_uuid_output_invalid");
    return { architecture: match[2], uuid: match[1].toUpperCase() };
  });
  if (new Set(rows.map(row => row.architecture)).size !== rows.length) {
    throw Error("ios_symbols_duplicate_architecture");
  }
  return rows.sort((a, b) => a.architecture.localeCompare(b.architecture));
}

function readDwarfUuids(file) {
  return parseDwarfUuids(execFileSync("xcrun", ["dwarfdump", "--uuid", file], {
    encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"],
  }));
}

export function inspectIosSymbols(appPath, symbolsPath, readUuids = readDwarfUuids) {
  return {
    schemaVersion: 1,
    status: "UUID_MATCHED",
    components: components.map(component => {
      const dwarf = `${component.dsym}/Contents/Resources/DWARF/${component.name}`;
      const binaryPath = path.join(appPath, component.binary);
      const dwarfPath = path.join(symbolsPath, dwarf);
      // Hash reads also reject missing files; never accept empty tool output.
      const binarySha256 = sha256(binaryPath), dwarfSha256 = sha256(dwarfPath);
      const uuids = readUuids(binaryPath), symbolUuids = readUuids(dwarfPath);
      if (!uuids.length || !isDeepStrictEqual(uuids, symbolUuids)) {
        throw Error(`ios_symbols_uuid_mismatch:${component.name}`);
      }
      return { ...component, dwarf, binarySha256, dwarfSha256, uuids };
    }),
  };
}

export function archiveIosSymbols(appPath, sourceSymbols, outputSymbols, options = {}) {
  const readUuids = options.readUuids ?? readDwarfUuids;
  const before = inspectIosSymbols(appPath, sourceSymbols, readUuids);
  // An existing destination belongs to a previous attempt. Do not overwrite it,
  // even when it contains a failed partial copy rather than a success manifest.
  mkdirSync(outputSymbols, { mode: 0o700 });
  for (const { dsym } of components) {
    (options.copy ?? cpSync)(path.join(sourceSymbols, dsym), path.join(outputSymbols, dsym), {
      recursive: true, force: false, errorOnExist: true, preserveTimestamps: true,
    });
  }
  const after = inspectIosSymbols(appPath, outputSymbols, readUuids);
  if (!isDeepStrictEqual(before, after)) throw Error("ios_symbols_archive_changed");
  writeFileSync(path.join(outputSymbols, "manifest.json"), `${JSON.stringify(after, null, 2)}\n`, {
    flag: "wx", mode: 0o600,
  });
  return after;
}

export function verifyIosSymbolArchive(appPath, symbolsPath, readUuids = readDwarfUuids) {
  const manifestPath = path.join(symbolsPath, "manifest.json");
  const recorded = JSON.parse(readFileSync(manifestPath, "utf8"));
  const actual = inspectIosSymbols(appPath, symbolsPath, readUuids);
  if (!isDeepStrictEqual(recorded, actual)) throw Error("ios_symbols_manifest_mismatch");
  return { status: actual.status, manifest: "Symbols/manifest.json", manifestSha256: sha256(manifestPath) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--verify" && args.length === 3) {
    console.log(JSON.stringify(verifyIosSymbolArchive(args[1], args[2])));
  } else if (args.length === 3) {
    console.log(JSON.stringify(archiveIosSymbols(...args)));
  } else {
    throw Error("Usage: archive_ios_candidate_symbols.mjs [--verify] app sourceSymbols [outputSymbols]");
  }
}
