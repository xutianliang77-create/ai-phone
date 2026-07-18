import type { EnterpriseDatabaseManifest } from "./enterprise-postgres-database-manifest.js";
import { stableEnterpriseCutoverJson as stableJson } from "./enterprise-postgres-database-manifest.js";

export interface EnterpriseDatabaseComparison {
  status: "matched" | "mismatch";
  sourceSha256: string;
  targetSha256: string;
  missingTables: string[];
  extraTables: string[];
  mismatchedTables: string[];
  publicMigrationsMatch: boolean;
  enterpriseMigrationsMatch: boolean;
  serverVersionMatch: boolean;
}

export function compareEnterpriseDatabaseManifests(
  source: EnterpriseDatabaseManifest,
  target: EnterpriseDatabaseManifest,
): EnterpriseDatabaseComparison {
  const sourceNames = Object.keys(source.tables).sort();
  const targetNames = Object.keys(target.tables).sort();
  const missingTables = sourceNames.filter((name) => !target.tables[name]);
  const extraTables = targetNames.filter((name) => !source.tables[name]);
  const mismatchedTables = sourceNames.filter((name) => {
    const left = source.tables[name];
    const right = target.tables[name];
    return right && (left.count !== right.count || left.sha256 !== right.sha256 ||
      stableJson(left.primaryKey) !== stableJson(right.primaryKey));
  });
  const publicMigrationsMatch = stableJson(source.publicMigrations) ===
    stableJson(target.publicMigrations);
  const enterpriseMigrationsMatch = stableJson(source.enterpriseMigrations) ===
    stableJson(target.enterpriseMigrations);
  const serverVersionMatch = source.database.serverVersionNum ===
    target.database.serverVersionNum;
  const matched = source.sha256 === target.sha256 && missingTables.length === 0 &&
    extraTables.length === 0 && mismatchedTables.length === 0 &&
    publicMigrationsMatch && enterpriseMigrationsMatch && serverVersionMatch;
  return {
    status: matched ? "matched" : "mismatch",
    sourceSha256: source.sha256,
    targetSha256: target.sha256,
    missingTables,
    extraTables,
    mismatchedTables,
    publicMigrationsMatch,
    enterpriseMigrationsMatch,
    serverVersionMatch,
  };
}
