import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

export function verifyExecutable(file, expectedSha256) {
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (actual !== expectedSha256) {
    throw new Error(`Provider executable checksum mismatch: ${file}`);
  }
}

export function runProviderProcess(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const limit = options.maxBytes ?? 1024 * 1024;
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const append = (current, chunk) => {
      const next = current + chunk.toString("utf8");
      if (Buffer.byteLength(next) > limit) {
        child.kill("SIGTERM");
        throw new Error("Provider process output exceeded its bound");
      }
      return next;
    };
    child.stdout.on("data", (chunk) => {
      try { stdout = append(stdout, chunk); } catch (error) { finish(error); }
    });
    child.stderr.on("data", (chunk) => {
      try { stderr = append(stderr, chunk); } catch (error) { finish(error); }
    });
    child.once("error", finish);
    child.once("exit", (code, signal) => {
      if (code === 0) finish(null, { stdout, stderr });
      else finish(new Error(
        `Provider process failed code=${code ?? "null"} signal=${signal ?? "none"}`,
      ));
    });
    timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("Provider process exceeded its bounded timeout"));
    }, options.timeoutMs ?? 60_000);
  });
}

export function hashProviderProcessOutput(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const hash = createHash("sha256");
    const stderrLimit = options.stderrMaxBytes ?? 64 * 1024;
    let stdoutBytes = 0;
    let pendingLine = "";
    let stderr = "";
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (!options.normalizeLine) {
        hash.update(chunk);
        return;
      }
      pendingLine += chunk.toString("utf8");
      const lines = pendingLine.split("\n");
      pendingLine = lines.pop() ?? "";
      for (const line of lines) updateNormalizedHash(hash, line, options.normalizeLine, true);
      if (Buffer.byteLength(pendingLine) > (options.maxLineBytes ?? 4 * 1024 * 1024)) {
        child.kill("SIGTERM");
        finish(new Error("Provider process line exceeded its bound"));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (Buffer.byteLength(stderr) > stderrLimit) {
        child.kill("SIGTERM");
        finish(new Error("Provider process stderr exceeded its bound"));
      }
    });
    child.once("error", finish);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        if (options.normalizeLine && pendingLine.length > 0) {
          updateNormalizedHash(hash, pendingLine, options.normalizeLine, false);
        }
        finish(null, { stdoutSha256: hash.digest("hex"), stdoutBytes, stderr });
      } else {
        finish(new Error(
          `Provider process failed code=${code ?? "null"} signal=${signal ?? "none"}`,
        ));
      }
    });
    timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("Provider process exceeded its bounded timeout"));
    }, options.timeoutMs ?? 60_000);
  });
}

function updateNormalizedHash(hash, line, normalizeLine, newline) {
  const normalized = normalizeLine(line);
  if (normalized === null || normalized === undefined) return;
  hash.update(normalized);
  if (newline) hash.update("\n");
}

export function selectedEnvironment(keys, extra = {}) {
  const environment = {};
  for (const key of keys ?? []) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return { ...environment, ...extra };
}

export function parseSingleJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not emit valid JSON`);
  }
}
