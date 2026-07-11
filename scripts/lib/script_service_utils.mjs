import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createWriteStream } from "node:fs";

export function startNpmWorkspaceService({ root, logPath, name, script, workspace, env }) {
  const log = createWriteStream(logPath, { flags: "w" });
  const child = spawn("npm", ["run", script, "-w", workspace], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const service = { name, child, logPath, exited: false, exitCode: null };
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on("exit", (code) => {
    service.exited = true;
    service.exitCode = code;
  });
  return service;
}

export async function waitForHttpService(options) {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    if (options.service.exited) {
      throw new Error(`${options.label} exited early; see ${options.service.logPath}`);
    }
    try {
      const response = await requestJson(options.url, { timeoutMs: 1000 });
      if (response.status === 200) return;
    } catch {
      // Startup races are expected while tsx compiles the service.
    }
    await sleep(250);
  }
  throw new Error(`${options.label} did not become healthy; see ${options.service.logPath}`);
}

export async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
  try {
    const response = await (options.fetchFn ?? fetch)(url, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.bearerToken ? { authorization: `Bearer ${options.bearerToken}` } : {}),
        ...(options.headers ?? {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok && !options.allowError) {
      throw new Error(body?.error?.message ?? `${url} returned HTTP ${response.status}`);
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export async function openPort() {
  const server = createServer();
  await listen(server, 0);
  const port = server.address().port;
  await closeServer(server);
  return port;
}

export function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

export function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

export async function stopServices(services) {
  for (const service of services) {
    if (!service.exited) service.child.kill("SIGTERM");
  }
  await Promise.all(services.map((service) => waitForExit(service)));
}

export function waitForExit(service) {
  if (service.exited) return Promise.resolve();
  return new Promise((resolve) => {
    service.child.once("exit", resolve);
    setTimeout(resolve, 2000);
  });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
