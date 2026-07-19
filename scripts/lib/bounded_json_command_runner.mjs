import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;

export class BoundedJsonCommandRunner {
  constructor(options) {
    this.root = options.root ?? process.cwd();
    this.gracefulDrainSeconds = options.gracefulDrainSeconds;
    this.outputDirectory = path.resolve(this.root, options.outputDirectory);
    this.children = new Set();
    mkdirSync(path.join(this.outputDirectory, "commands"), { recursive: true });
  }

  execute(command, options) {
    return new Promise((resolve, reject) => {
      const inheritedEnvironment = selectEnvironment(command.environmentKeys);
      const environment = { ...inheritedEnvironment, ...options.env };
      const secretValues = environmentSecrets(environment);
      const child = spawn(command.file, command.args, {
        cwd: this.root,
        env: environment,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.children.add(child);
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", aborted);
        this.children.delete(child);
        persistEvidence(
          this.outputDirectory,
          options.label,
          redact(stdout, secretValues),
          redact(stderr, secretValues),
        );
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => {
        terminate(child);
        finish(new Error(`${options.label} exceeded its bounded timeout`));
      }, options.timeoutMs);
      const aborted = () => {
        terminate(child);
        finish(options.signal.reason ?? new Error("JSON command aborted"));
      };
      options.signal?.addEventListener("abort", aborted, { once: true });
      child.stdout.on("data", (chunk) => {
        try {
          stdout = appendBounded(stdout, chunk, options.label);
        } catch (error) {
          terminate(child);
          finish(error);
        }
      });
      child.stderr.on("data", (chunk) => {
        try {
          stderr = appendBounded(stderr, chunk, options.label);
        } catch (error) {
          terminate(child);
          finish(error);
        }
      });
      child.once("error", finish);
      child.once("exit", (code, signal) => {
        if (settled) return;
        if (code !== 0) {
          finish(new Error(
            `${options.label} exited code=${code ?? "null"} signal=${signal ?? "none"}`,
          ));
          return;
        }
        try {
          finish(null, JSON.parse(redact(stdout, secretValues).toString("utf8")));
        } catch {
          finish(new Error(`${options.label} did not emit one JSON document on stdout`));
        }
      });
    });
  }

  async shutdown() {
    const children = [...this.children];
    for (const child of children) child.kill("SIGTERM");
    if (children.length === 0) return;
    await Promise.race([
      Promise.allSettled(children.map(waitForExit)),
      delay(this.gracefulDrainSeconds * 1000),
    ]);
    for (const child of this.children) child.kill("SIGKILL");
  }
}

function appendBounded(current, chunk, label) {
  const next = Buffer.concat([current, Buffer.from(chunk)]);
  if (next.length > MAX_CAPTURE_BYTES) {
    throw new Error(`${label} output exceeded ${MAX_CAPTURE_BYTES} bytes`);
  }
  return next;
}

function persistEvidence(directory, label, stdout, stderr) {
  const safe = label.replace(/[^A-Za-z0-9_-]/g, "_");
  const base = path.join(directory, "commands", safe);
  writeFileSync(`${base}.json`, stdout, { mode: 0o600 });
  if (stderr.length > 0) {
    writeFileSync(`${base}.stderr.log`, stderr, { mode: 0o600 });
  }
}

function selectEnvironment(keys) {
  if (!Array.isArray(keys)) return process.env;
  const selected = {};
  for (const key of keys) {
    if (process.env[key] !== undefined) selected[key] = process.env[key];
  }
  return selected;
}

function environmentSecrets(environment) {
  return Object.entries(environment)
    .filter(([key, value]) =>
      /(?:^|_)(?:PASSWORD|SECRET|TOKEN|CREDENTIALS?|PRIVATE_KEY|PASSFILE|LIBSODIUM_KEY|ENCRYPTION_KEY|API_KEY)(?:_|$)/i
        .test(key) &&
      typeof value === "string" && value.length >= 4)
    .map(([, value]) => value)
    .sort((left, right) => right.length - left.length);
}

function redact(value, secrets) {
  let text = value.toString("utf8");
  for (const secret of secrets) {
    const escaped = JSON.stringify(secret).slice(1, -1);
    for (const candidate of new Set([secret, escaped])) {
      text = text.split(candidate).join("[REDACTED]");
    }
  }
  return Buffer.from(text, "utf8");
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

function terminate(child) {
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 5000);
  timer.unref();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
