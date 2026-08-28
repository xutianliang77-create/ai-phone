import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

const ENTRY_PATTERN =
  /^([0-9a-f]{64})\t([A-Za-z0-9_./-]+)\t([A-Za-z0-9_.-]+)$/;

export async function prepareAir780LuatoolsBundle({
  firmwareRoot,
  outputDirectory,
  manifestName = "PROD_FLASH_MANIFEST.tsv",
}) {
  const root = resolve(firmwareRoot);
  const output = resolve(outputDirectory);
  if (output === root || output.startsWith(`${root}${sep}`)) {
    throw new Error("Air780 bundle output must be outside the firmware source tree");
  }
  const manifestPath = resolve(root, manifestName);
  if (!manifestPath.startsWith(`${root}${sep}`)) {
    throw new Error("Air780 manifest must be inside the firmware source tree");
  }
  const manifest = await readFile(manifestPath, "utf8");
  const entries = parseAir780FlashManifest(manifest);
  await assertEmptyDirectory(output);

  for (const entry of entries) {
    const source = resolve(root, entry.source);
    if (!source.startsWith(`${root}${sep}`)) {
      throw new Error(`Air780 source escapes firmware root: ${entry.source}`);
    }
    const bytes = await readFile(source);
    const actual = sha256(bytes);
    if (actual !== entry.hash) {
      throw new Error(`Air780 source hash mismatch: ${entry.source}`);
    }
  }

  await mkdir(output, { recursive: true, mode: 0o700 });
  for (const entry of entries) {
    const target = resolve(output, entry.target);
    await copyFile(resolve(root, entry.source), target);
    const copied = await readFile(target);
    if (sha256(copied) !== entry.hash) {
      throw new Error(`Air780 copied file hash mismatch: ${entry.target}`);
    }
  }

  return {
    outputDirectory: output,
    fileCount: entries.length,
    manifestSha256: sha256(Buffer.from(normalizedManifest(entries))),
    files: entries.map(({ target, hash }) => ({ target, hash })),
  };
}

export function parseAir780FlashManifest(input) {
  const lines = input.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) throw new Error("Air780 flash manifest is empty");
  const targets = new Set();
  return lines.map((line) => {
    const match = ENTRY_PATTERN.exec(line);
    if (!match) throw new Error("Air780 flash manifest entry is invalid");
    const [, hash, source, target] = match;
    if (!source.endsWith(".lua") || !target.endsWith(".lua") ||
      /(?:^|[_./-])(?:test|mock)(?:[_./-]|$)/i.test(source)) {
      throw new Error(`Air780 production manifest source is unsafe: ${source}`);
    }
    if (Buffer.byteLength(target, "utf8") > 24) {
      throw new Error(`Air780 Luatools target exceeds 24 bytes: ${target}`);
    }
    if (targets.has(target)) {
      throw new Error(`Air780 Luatools target is duplicated: ${target}`);
    }
    targets.add(target);
    return { hash, source, target };
  });
}

async function assertEmptyDirectory(path) {
  try {
    const metadata = await stat(path);
    if (!metadata.isDirectory()) {
      throw new Error("Air780 bundle output exists and is not a directory");
    }
    if ((await readdir(path)).length > 0) {
      throw new Error("Air780 bundle output directory must be empty");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function normalizedManifest(entries) {
  return `${entries.map(({ hash, source, target }) =>
    `${hash}\t${source}\t${target}`).join("\n")}\n`;
}

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}
