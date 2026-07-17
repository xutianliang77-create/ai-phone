import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(root, "services/api-server/src");
const release = process.argv.includes("--release");
const summaryOnly = process.argv.includes("--summary");
const legacyRepositories = new Set([
  "modules/sessions/sessions.repository.ts",
  "modules/provider-operations/provider-operations.repository.ts",
  "modules/worker-dispatches/worker-dispatch.repository.ts",
  "modules/recordings/recordings.repository.ts",
  "modules/recordings/recording-artifacts.repository.ts",
  "modules/ingress/ingress.repository.ts",
  "modules/agent-calls/agent-orchestration.repository.ts",
  "modules/agent-calls/agent-consult.repository.ts",
]);
const snapshotAllowlist = new Set([
  "infrastructure/storage/postgres-cutover-audit.ts",
  "infrastructure/storage/postgres-projection-outbox.ts",
  "infrastructure/storage/postgres-primary-import-records.ts",
  "infrastructure/storage/postgres-projection-status.ts",
  "infrastructure/storage/postgres-projection.repository.ts",
  "infrastructure/storage/repository-runtime.ts",
  "infrastructure/storage/sqlite-store-admin.ts",
  "modules/call-links/call-guest-ticket.ts",
  "modules/sessions/session-completion.ts",
  "modules/sessions/sessions-recovery.repository.ts",
]);
const legacyImportAllowlist = new Set([
  "modules/sessions/session-completion.ts",
  "modules/sessions/sessions-runtime.repository.ts",
]);
const legacyImports = [];
const snapshotImports = [];

for (const file of sourceFiles(sourceRoot)) {
  const local = relative(sourceRoot, file);
  if (local.endsWith(".test.ts") || legacyRepositories.has(local)) continue;
  const source = readFileSync(file, "utf8");
  for (const imported of importSpecifiers(source)) {
    if (imported.typeOnly) continue;
    const target = resolveImport(file, imported.specifier);
    if (!target) continue;
    const targetLocal = relative(sourceRoot, target);
    if (legacyRepositories.has(targetLocal) && !legacyImportAllowlist.has(local)) {
      legacyImports.push({ file: local, target: targetLocal });
    }
    if (targetLocal === "infrastructure/storage/json-store.ts" &&
      !snapshotAllowlist.has(local)) {
      snapshotImports.push({ file: local, target: targetLocal });
    }
  }
}

const report = {
  status: legacyImports.length === 0 && snapshotImports.length === 0
    ? "ready" : "blocked",
  legacyRepositoryImportCount: legacyImports.length,
  directSnapshotImportCount: snapshotImports.length,
  legacyImports,
  snapshotImports,
};
process.stdout.write(`${JSON.stringify(summaryOnly ? {
  status: report.status,
  legacyRepositoryImportCount: report.legacyRepositoryImportCount,
  directSnapshotImportCount: report.directSnapshotImportCount,
} : report, null, 2)}\n`);
if (release && report.status !== "ready") process.exitCode = 2;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

function importSpecifiers(source) {
  const values = [];
  const pattern = /import\s+(type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    values.push({ typeOnly: Boolean(match[1]), specifier: match[2] });
  }
  return values;
}

function resolveImport(file, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(file), specifier.replace(/\.js$/, ""));
  for (const candidate of [`${base}.ts`, resolve(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
