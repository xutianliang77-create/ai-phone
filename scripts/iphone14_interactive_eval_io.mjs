import { spawnSync } from "node:child_process";

export function sleepSeconds(seconds) {
  spawnSync("sleep", [String(seconds)]);
}

export function compactStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
}

export function relativePath(rootDir, path) {
  return path.replace(`${rootDir}/`, "");
}

export function readJsonBody(request) {
  return new Promise((resolvePromise, rejectPromise) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolvePromise({});
        return;
      }
      try {
        resolvePromise(JSON.parse(body));
      } catch (error) {
        rejectPromise(error);
      }
    });
    request.on("error", rejectPromise);
  });
}

export function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

export function spawnChecked(commandName, args) {
  const result = spawnSync(commandName, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${commandName} failed with status ${result.status}`);
  }
}

export function spawnQuiet(commandName, args) {
  const result = spawnSync(commandName, args, { stdio: "pipe" });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim();
    throw new Error(
      `${commandName} failed with status ${result.status}` +
        `${stderr ? `: ${stderr}` : ""}`,
    );
  }
}
