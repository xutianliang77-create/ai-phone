export function hasRealValue(value) {
  return typeof value === "string" && value.trim() !== "" && !isPlaceholder(value);
}

export function isImmutableImage(value) {
  return typeof value === "string" &&
    /^[a-z0-9._/-]+:[a-z0-9._-]+@sha256:[a-f0-9]{64}$/i.test(value);
}

export function isPlaceholder(value) {
  return /required|replace|example|your-|todo|待填|localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(
    String(value ?? ""),
  );
}

export function isPublicDomain(value) {
  if (!hasRealValue(value)) return false;
  if (/^https?:|^wss?:/i.test(value)) return false;
  if (/[/:]/.test(value)) return false;
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(value);
}

export function isPort(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 65535;
}

export function unquote(value) {
  return value.replace(/^["']|["']$/g, "");
}

export function yamlQuote(value) {
  return JSON.stringify(String(value));
}

export function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}

export function selfHostResult(envFile, checks, issues, env = {}) {
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    envFile,
    releaseSnippet: issues.length === 0 ? `LIVEKIT_URL=wss://${env.LIVEKIT_DOMAIN}` : null,
    checks,
    issues,
    actions: issues.length === 0
      ? []
      : [
          "Fill infra/livekit-selfhost/.env with production domains and secrets, then rerun this check.",
        ],
  };
}
