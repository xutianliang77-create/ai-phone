import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const result = { urls: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--url") {
      const separator = value.indexOf("=");
      if (separator < 1) throw new Error("--url must use service=https://host/health");
      result.urls[value.slice(0, separator)] = value.slice(separator + 1);
    } else if (key.startsWith("--")) {
      result[key.slice(2)] = value;
    }
    index += 1;
  }
  return result;
}

function matchesExpected(body, expected) {
  const issues = [];
  for (const [field, value] of Object.entries(expected ?? {})) {
    if (body?.[field] !== value) {
      issues.push(`${field}: expected ${JSON.stringify(value)}, got ${JSON.stringify(body?.[field])}`);
    }
  }
  return issues;
}

function fingerprintIssues(body, fields) {
  return (fields ?? []).flatMap((field) =>
    typeof body?.[field] === "string" && /^[a-f0-9]{64}$/.test(body[field])
      ? []
      : [`${field}: missing or invalid SHA-256 fingerprint`]
  );
}

function traceableRuntimeIssues(body, required) {
  return required && body?.runtimeIdentity?.traceable !== true
    ? ["runtimeIdentity: missing or not traceable"]
    : [];
}

async function probe(name, url, contract, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { name, url, ok: false, statusCode: response.status, issues: ["response is not JSON"] };
    }
    const issues = [
      ...(!response.ok ? [`HTTP ${response.status}`] : []),
      ...matchesExpected(body, contract.expected),
      ...fingerprintIssues(body, contract.requiredFingerprintFields),
      ...traceableRuntimeIssues(body, contract.requiredTraceableRuntime),
    ];
    return { name, url, ok: issues.length === 0, statusCode: response.status, issues, body };
  } catch (error) {
    return { name, url, ok: false, issues: [error instanceof Error ? error.message : String(error)] };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeRuntimeContract({ contract, urls, timeoutMs = 3000, generatedAt } = {}) {
  const services = await Promise.all(Object.entries(contract.services).map(async ([name, service]) => {
    const url = urls[name];
    if (!url) return { name, ok: false, issues: ["health URL not supplied"] };
    return probe(name, url, service, timeoutMs);
  }));
  const byName = Object.fromEntries(services.map((service) => [service.name, service]));
  const required = (field) => Object.entries(contract.services)
    .filter(([, service]) => service[field])
    .every(([name]) => byName[name]?.ok === true);
  return {
    schemaVersion: 1,
    generatedAt: generatedAt ?? new Date().toISOString(),
    profile: contract.profile,
    sessionReady: required("requiredForSession"),
    releaseReady: required("requiredForRelease"),
    services: byName,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.contract || !args.output) throw new Error("--contract and --output are required");
  const contract = JSON.parse(readFileSync(resolve(args.contract), "utf8"));
  const evidence = await probeRuntimeContract({
    contract,
    urls: args.urls,
    timeoutMs: Number(args.timeout ?? 3000),
  });
  const output = resolve(args.output);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${output}\n`);
  if (!evidence.releaseReady) process.exitCode = 1;
}
