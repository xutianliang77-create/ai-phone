import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const nodePackagePaths = {
  serverSdk: ["node_modules/livekit-server-sdk"],
  browserClient: ["node_modules/livekit-client"],
  rtcNode: ["node_modules/@livekit/rtc-node"],
  agentsJs: [
    "services/translation-worker/node_modules/@livekit/agents",
    "services/voice-agent-runtime/node_modules/@livekit/agents",
  ],
  agentsOpenAi: [
    "services/voice-agent-runtime/node_modules/@livekit/agents-plugin-openai",
  ],
};

export function checkLiveKitCompatibilityProfile(options = {}) {
  const root = options.root ?? process.cwd();
  const profileFile = path.resolve(
    root,
    options.profileFile ?? "infra/livekit-compatibility-profile.json",
  );
  if (!existsSync(profileFile)) {
    return result(profileFile, [`LiveKit compatibility profile missing: ${profileFile}`]);
  }
  const profile = JSON.parse(readFileSync(profileFile, "utf8"));
  const issues = [];
  if (profile.schemaVersion !== 1) {
    issues.push("LiveKit compatibility profile schemaVersion must be 1");
  }
  const packageLock = JSON.parse(
    readFileSync(path.join(root, "package-lock.json"), "utf8"),
  );
  checkNodePackages(profile, packageLock, issues);
  checkFlutterPackage(profile, root, issues);
  checkImages(profile, issues, options.release === true);
  return result(profileFile, issues, profile);
}

function checkNodePackages(profile, packageLock, issues) {
  for (const [name, packagePaths] of Object.entries(nodePackagePaths)) {
    const expected = profile.packages?.[name];
    const actual = packagePaths.map(
      (packagePath) => packageLock.packages?.[packagePath]?.version ?? ""
    );
    if (!expected) {
      issues.push(`LiveKit compatibility profile missing package ${name}`);
      continue;
    }
    if (expected.status === "not_integrated") {
      if (actual.some(Boolean)) {
        issues.push(`${expected.package} is installed but marked not_integrated`);
      }
      continue;
    }
    if (!expected.version || actual.some((version) => version !== expected.version)) {
      issues.push(
        `${expected.package} version mismatch: expected ${expected.version}, ` +
          `actual ${actual.map((version) => version || "missing").join(",")}`,
      );
    }
  }
}

function checkFlutterPackage(profile, root, issues) {
  const expected = profile.packages?.flutterClient;
  if (!expected) {
    issues.push("LiveKit compatibility profile missing flutterClient");
    return;
  }
  const lock = readFileSync(path.join(root, "apps/mobile/pubspec.lock"), "utf8");
  const actual = lock.match(
    /  livekit_client:\n(?:.*\n){1,8}?    version: "([^"]+)"/,
  )?.[1] ?? "";
  if (actual !== expected.version) {
    issues.push(
      `livekit_client version mismatch: expected ${expected.version}, actual ${actual}`,
    );
  }
}

function checkImages(profile, issues, release) {
  for (const [name, image] of Object.entries(profile.images ?? {})) {
    if (/latest/i.test(image.tag ?? "")) {
      issues.push(`LiveKit ${name} image must not use latest`);
    }
    if (image.status === "not_integrated") continue;
    if (image.status === "deferred_runtime_probe") {
      if (release) issues.push(`LiveKit ${name} image runtime probe is deferred`);
      continue;
    }
    if (!image.tag) issues.push(`LiveKit ${name} image tag is missing`);
    if (image.platform !== "linux/amd64" && image.platform !== "linux/arm64") {
      issues.push(`LiveKit ${name} image platform is not supported`);
    }
    if (image.digest && !/^sha256:[a-f0-9]{64}$/.test(image.digest)) {
      issues.push(`LiveKit ${name} image digest is invalid`);
    }
    if (!release) continue;
    if (image.status !== "verified") {
      issues.push(`LiveKit ${name} image is not verified`);
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(image.digest ?? "")) {
      issues.push(`LiveKit ${name} image digest is not pinned`);
    }
  }
}

function result(profileFile, issues, profile) {
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    profileFile,
    issues,
    ...(profile ? { profile } : {}),
  };
}
