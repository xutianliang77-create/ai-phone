import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const release = process.argv.includes("--release");
const workspace = resolve(process.cwd());
const dist = join(workspace, "dist");
const matrixPath = join(workspace, "enterprise-release-matrix.json");
const issues = [];

const matrix = readJson(matrixPath, "release matrix");
validateMatrix(matrix);
const files = listFiles(dist);
const textAssets = files.filter((path) => /\.(?:html|js|css)$/.test(path));
const htmlAssets = textAssets.filter((path) => path.endsWith(".html"));
if (!textAssets.some((path) => path.endsWith(".html"))) issues.push("HTML entry missing");
if (!textAssets.some((path) => path.endsWith(".js"))) issues.push("JavaScript bundle missing");
if (!textAssets.some((path) => path.endsWith(".css"))) issues.push("CSS bundle missing");
if (files.some((path) => path.endsWith(".map"))) issues.push("source maps must not ship");

const javascriptAssets = textAssets.filter((path) => path.endsWith(".js"));
const entryJavaScript = entryJavaScriptAssets(htmlAssets, javascriptAssets);
if (entryJavaScript.length === 0) issues.push("initial JavaScript entry missing");
const sizes = {
  entryJavaScript: sumSize(entryJavaScript),
  javascript: sumSize(javascriptAssets),
  css: sumSize(textAssets.filter((path) => path.endsWith(".css"))),
};
if (sizes.entryJavaScript > 512 * 1024) {
  issues.push("initial JavaScript exceeds 512 KiB budget");
}
if (sizes.javascript > 1024 * 1024) issues.push("total JavaScript exceeds 1 MiB budget");
if (sizes.css > 96 * 1024) issues.push("CSS exceeds 96 KiB budget");

const bundleText = textAssets.map((path) => readFileSync(path, "utf8")).join("\n");
const forbidden = [
  ["local filesystem path", /(?:\/Users\/|[A-Z]:\\Users\\)/i],
  ["local/internal endpoint", /(?:(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+|\/)|(?:https?|wss?):\/\/[^\s"'`]*\.internal\b|beelink)/i],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["cloud access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["fixture identity", /(?:tenant-fixture|fixture-token|矩阵测试企业|enterprise\.example)/i],
  ["development login code", /开发环境验证码|debugCode/],
];
for (const [label, pattern] of forbidden) {
  if (pattern.test(bundleText)) issues.push(`${label} found in production bundle`);
}

if (release) validateReleaseMetadata(bundleText);
if (issues.length > 0) {
  console.error("Enterprise Web release gate failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}
console.log(JSON.stringify({
  status: "passed",
  files: files.length,
  entryJavaScriptBytes: sizes.entryJavaScript,
  javascriptBytes: sizes.javascript,
  cssBytes: sizes.css,
  releaseMetadataRequired: release,
}, null, 2));

function validateMatrix(value) {
  if (!value || value.schemaVersion !== 1) {
    issues.push("release matrix schemaVersion must be 1");
    return;
  }
  exactSet(value.roles, [
    "owner", "admin", "marketing_manager", "marketing_member", "support_manager",
    "support_agent", "meeting_host", "member", "auditor",
  ], "roles");
  exactSet(value.pageStates, [
    "loading", "empty", "not_ready", "degraded", "forbidden", "conflict",
    "processing", "failed",
  ], "page states");
  exactSet(value.viewports, [320, 600, 960, 1280, 1440], "viewports");
  exactSet(value.themes, ["light", "dark"], "themes");
  exactSet(value.browserEngines, ["chromium", "firefox", "webkit"], "browsers");
  exactSet(value.requiredSuites, [
    "unit", "contract", "role-route", "responsive", "visual", "keyboard", "axe",
    "bundle", "telemetry",
  ], "required suites");
}

function validateReleaseMetadata(text) {
  const version = process.env.VITE_ENTERPRISE_RELEASE_VERSION?.trim();
  const commit = process.env.VITE_ENTERPRISE_RELEASE_COMMIT?.trim();
  if (!version || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(version)) {
    issues.push("VITE_ENTERPRISE_RELEASE_VERSION missing or invalid");
  } else if (!text.includes(version)) {
    issues.push("release version not embedded in bundle");
  }
  if (!commit || !/^[a-f0-9]{7,40}$/.test(commit)) {
    issues.push("VITE_ENTERPRISE_RELEASE_COMMIT missing or invalid");
  } else if (!text.includes(commit)) {
    issues.push("release commit not embedded in bundle");
  }
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: workspace,
      encoding: "utf8",
    }).trim();
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: workspace,
      encoding: "utf8",
    }).trim();
    if (commit && !head.startsWith(commit) && !commit.startsWith(head)) {
      issues.push("release commit does not match checked-out HEAD");
    }
    if (status) issues.push("release gate requires a clean worktree");
  } catch {
    issues.push("release gate could not verify git identity");
  }
}

function exactSet(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length ||
    expected.some((item) => !actual.includes(item))) {
    issues.push(`release matrix ${label} are incomplete`);
  }
}

function listFiles(path) {
  try {
    return readdirSync(path).flatMap((entry) => {
      const child = join(path, entry);
      return statSync(child).isDirectory() ? listFiles(child) : [child];
    });
  } catch {
    issues.push(`build directory missing: ${path}`);
    return [];
  }
}

function sumSize(paths) {
  return paths.reduce((total, path) => total + statSync(path).size, 0);
}

function entryJavaScriptAssets(htmlPaths, javascriptPaths) {
  const names = new Set(htmlPaths.flatMap((path) =>
    [...readFileSync(path, "utf8").matchAll(/<script[^>]+src="([^"]+\.js)"/g)]
      .map((match) => match[1]?.split("/").pop())
      .filter(Boolean),
  ));
  return javascriptPaths.filter((path) => names.has(path.split("/").pop()));
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    issues.push(`${label} missing or invalid: ${path}`);
    return null;
  }
}
