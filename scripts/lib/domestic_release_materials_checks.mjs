import { spawn } from "node:child_process";

export async function appendReleaseMaterialsReadiness(context) {
  if (!context.enabled) {
    context.record(context.checks, "release_materials_readiness", true, { skipped: true });
    return;
  }
  const checkFn = context.checkFn ?? checkReleaseMaterialsReadiness;
  const result = await checkFn({ root: context.root, file: context.file, timeoutMs: context.timeoutMs });
  const ready = result.status === "ready";
  context.record(context.checks, "release_materials_readiness", ready, {
    status: result.status,
    manifestPath: result.manifestPath,
    checkedItems: result.checkedItems ?? [],
  });
  if (!ready) {
    context.issues.push("release_materials_readiness is not ready.");
    context.issues.push(...context.normalizeIssues(result.issues));
    context.actions.push(...(result.actions ?? ["Complete release/domestic/release-materials.json and set RELEASE_MATERIALS_FILE."]));
  }
}

export function checkReleaseMaterialsReadiness(options = {}) {
  return runReleaseMaterialsCheck(options);
}

function runReleaseMaterialsCheck(options) {
  return new Promise((resolve) => {
    const args = ["run", "check:domestic-release-materials", "--", "--json"];
    if (options.file) args.push("--file", options.file);
    const child = spawn("npm", args, {
      cwd: options.root ?? process.cwd(),
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), Number(options.timeoutMs ?? 30000));
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(parseReleaseMaterialsOutput(stdout, stderr));
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: "not_ready", issues: [error.message], actions: [] });
    });
  });
}

function parseReleaseMaterialsOutput(stdout, stderr) {
  try {
    return JSON.parse(stdout.slice(stdout.indexOf("{")));
  } catch {
    return {
      status: "not_ready",
      issues: [stderr.trim() || stdout.trim() || "release materials check produced no JSON"],
      actions: [],
    };
  }
}
