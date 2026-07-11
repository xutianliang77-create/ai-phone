import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const requiredIgnorePatterns = [
  "release/domestic/release.env",
  "apps/mobile/android/key.properties",
  "apps/mobile/android/release/*.jks",
  "apps/mobile/android/release/*.keystore",
];

const requiredExampleFiles = [
  "release/domestic/release.env.example",
  "apps/mobile/android/key.properties.example",
];

export function checkDomesticReleaseSecretHygiene(options = {}) {
  const root = options.root ?? process.cwd();
  const gitignorePath = path.resolve(root, ".gitignore");
  const checks = [];
  const issues = [];

  if (!existsSync(gitignorePath)) {
    return result(gitignorePath, checks, [
      "domestic secret hygiene missing .gitignore",
    ]);
  }

  const patterns = parseGitignore(readFileSync(gitignorePath, "utf8"));
  for (const pattern of requiredIgnorePatterns) {
    const ok = hasPattern(patterns, pattern);
    checks.push({ name: `gitignore:${pattern}`, status: ok ? "pass" : "fail" });
    if (!ok)
      issues.push(`domestic secret hygiene missing ignore pattern: ${pattern}`);
  }

  for (const file of requiredExampleFiles) {
    const ok = existsSync(path.resolve(root, file));
    checks.push({ name: `example:${file}`, status: ok ? "pass" : "fail" });
    if (!ok)
      issues.push(`domestic secret hygiene missing example file: ${file}`);
  }

  return result(gitignorePath, checks, issues);
}

export function appendDomesticReleaseSecretHygiene(context) {
  const checkFn = context.checkFn ?? checkDomesticReleaseSecretHygiene;
  const result = checkFn({ root: context.root });
  const ready = result.status === "ready";
  context.record(context.checks, "domestic_release_secret_hygiene", ready, {
    status: result.status,
    gitignorePath: result.gitignorePath,
    checks: result.checks,
  });
  if (!ready) {
    context.issues.push("domestic_release_secret_hygiene is not ready.");
    context.issues.push(...context.normalizeIssues(result.issues));
    context.actions.push(...(result.actions ?? []));
  }
}

function parseGitignore(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function hasPattern(patterns, expected) {
  return patterns.some((pattern) => normalizePattern(pattern) === expected);
}

function normalizePattern(pattern) {
  return pattern.replace(/^\/+/, "").replace(/\/+$/, "");
}

function result(gitignorePath, checks, issues) {
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    gitignorePath,
    checks,
    issues,
    actions:
      issues.length === 0
        ? []
        : [
            "Add domestic release secret files to .gitignore before filling production credentials.",
          ],
  };
}
