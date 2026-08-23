import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function parsePorcelain(raw) {
  const records = raw.split("\0").filter(Boolean);
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const status = record.slice(0, 2);
    let path = record.slice(3);
    if (status.includes("R") || status.includes("C")) {
      path = records[index += 1] ?? path;
    }
    entries.push({ status, path, tracked: status !== "??" });
  }
  return entries;
}

export function classifyWipPath(path) {
  if (path.startsWith("outputs/")) return "outputs";
  if (path.startsWith("apps/mobile/")) return "mobile";
  if (path.startsWith("services/realtime-gateway/")) return "realtime-gateway";
  if (path.startsWith("services/api-server/")) return "api-server";
  if (path.startsWith("services/translation-worker/")) return "translation-worker";
  if (path.startsWith("services/voice-agent-runtime/")) return "voice-agent-runtime";
  if (path.startsWith("services/model-services/")) return "model-services";
  if (path.startsWith("services/air-device-gateway/") || path.startsWith("firmware/air780")) {
    return "air780";
  }
  if (path.startsWith("services/pstn-bridge/")) return "pstn-bridge";
  if (path.startsWith("packages/contracts/")) return "contracts";
  if (path.startsWith("infra/")) return "infra";
  if (path.startsWith("release/")) return "release";
  if (path.startsWith("scripts/") || path.startsWith("tools/")) return "tooling";
  if (path.startsWith("docs/") || path === "PROGRESS_LOG.md") return "docs";
  if (path === "package.json" || path === "package-lock.json" || path.startsWith(".")) {
    return "root-dependencies";
  }
  return "other";
}

export function buildWipInventory(entries) {
  const groups = {};
  for (const entry of entries) {
    const group = classifyWipPath(entry.path);
    groups[group] ??= { tracked: 0, untracked: 0, total: 0, paths: [] };
    groups[group][entry.tracked ? "tracked" : "untracked"] += 1;
    groups[group].total += 1;
    groups[group].paths.push({ status: entry.status, path: entry.path });
  }
  for (const value of Object.values(groups)) {
    value.paths.sort((left, right) => left.path.localeCompare(right.path));
  }
  return {
    total: entries.length,
    tracked: entries.filter((entry) => entry.tracked).length,
    untracked: entries.filter((entry) => !entry.tracked).length,
    outputsExcludedFromCandidates: groups.outputs?.total ?? 0,
    groups,
  };
}

function parseArgs(argv) {
  const outputIndex = argv.indexOf("--output");
  return {
    output: outputIndex >= 0 ? argv[outputIndex + 1] : undefined,
  };
}

export function generateWipInventory({ cwd = process.cwd(), generatedAt = new Date().toISOString() } = {}) {
  const raw = execFileSync(
    "git",
    ["status", "--porcelain=v1", "-z", "-uall"],
    { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return {
    schemaVersion: 1,
    generatedAt,
    ...buildWipInventory(parsePorcelain(raw)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const inventory = generateWipInventory();
  const serialized = `${JSON.stringify(inventory, null, 2)}\n`;
  if (!args.output) {
    process.stdout.write(serialized);
  } else {
    const output = resolve(args.output);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, serialized, { mode: 0o600 });
    process.stdout.write(`${output}\n`);
  }
}
