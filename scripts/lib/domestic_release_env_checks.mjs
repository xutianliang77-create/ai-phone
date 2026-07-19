import { checkDomesticReleaseEnvFile } from "./domestic_release_env_file_check.mjs";

export function appendDomesticReleaseEnvFileReadiness(context) {
  if (!context.enabled) {
    context.record(context.checks, "domestic_release_env_file", true, {
      skipped: true,
    });
    return;
  }
  const checkFn = context.checkFn ?? checkDomesticReleaseEnvFile;
  const result = checkFn({ root: context.root, file: context.file });
  const ready = result.status === "ready";
  context.record(context.checks, "domestic_release_env_file", ready, {
    status: result.status,
    filePath: result.filePath,
    profile: result.profile,
    deferredCapabilities: result.deferredCapabilities ?? [],
  });
  if (!ready) {
    context.issues.push("domestic_release_env_file is not ready.");
    context.issues.push(...context.normalizeIssues(result.issues));
    context.actions.push(...(result.actions ?? []));
  }
}
