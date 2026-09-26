#!/usr/bin/env node
// Authored for the final unified stage. Do not run while development-only /
// no-validation instructions are active. Never installs or starts the app.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { androidCandidateInputs, androidCandidateDefines, assertAndroidApkIdentity } from "./lib/android_public_candidate_contract.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const mobile = path.join(root, "apps/mobile");
const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== "build") {
  console.error("Usage (unified validation stage only): node scripts/build_traceable_android_candidate.mjs build\n" +
    "Required: PUBLIC_ANDROID_APPLICATION_ID, PUBLIC_DEPLOYMENT_ID, SERVER_BASE_URL, BUILD_NUMBER,\n" +
    "PUBLIC_ANDROID_CERT_SHA256, and existing public signing settings. Automatic language requires AUTOMATIC_LANGUAGE_PAIR.\n" +
    "Signing uses PUBLIC_ANDROID_* or the ignored public-key.properties; never private key.properties.\n" +
    "Uses existing Flutter/Android SDK tools; does not generate keys, install, deploy, or call a model.");
  process.exit(args.includes("--help") ? 0 : 2);
}

const env = { ...process.env, PUBLIC_ANDROID_BUILD: "true" };
function execute(command, commandArgs, { cwd = root, encoding = "utf8", log } = {}) {
  const result = spawnSync(command, commandArgs, { cwd, env, encoding, maxBuffer: 64 * 1024 * 1024 });
  if (log) {
    writeFileSync(`${log}.log`, `${result.stdout ?? ""}\n${result.stderr ?? ""}`, { flag: "wx", mode: 0o600 });
    writeFileSync(`${log}.result.json`, JSON.stringify({exitCode:result.status, signal:result.signal,
      spawnError:result.error?.code ?? null}) + "\n", { flag: "wx", mode: 0o600 });
  }
  if (result.error || result.status !== 0) throw Error(`${path.basename(command)} failed; ${log ? "see candidate log" : "exit " + result.status}`);
  return result.stdout;
}
const git = (...values) => execute("git", values).trim();
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
function requireCleanSource(source) {
  if (git("status", "--porcelain=v1", "--untracked-files=all") ||
      source && (git("rev-parse", "HEAD") !== source.commit || git("rev-parse", "HEAD^{tree}") !== source.tree)) {
    throw Error("Traceable Android candidate requires one unchanged clean source checkout");
  }
}

try {
  requireCleanSource();
  const source = { commit: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}") };
  const profilePath = path.join(root, "release/public/1.1.0/android-device-development.json");
  const profileBytes = readFileSync(profilePath);
  const input = androidCandidateInputs(env, source, JSON.parse(profileBytes), sha256(profileBytes));
  const keyProperties = path.resolve(mobile, "android", env.PUBLIC_ANDROID_KEY_PROPERTIES || "public-key.properties");
  if (existsSync(keyProperties) && (statSync(keyProperties).mode & 0o077) !== 0) {
    throw Error("Public signing properties must be readable only by their owner");
  }
  // No properties or password values enter the manifest or command line.
  env.PUBLIC_ANDROID_APPLICATION_ID = input.applicationId;
  const modelManifest = JSON.parse(readFileSync(path.join(root, "release/public/1.1.0/android-vad-model-candidate.json"), "utf8"));
  const model = modelManifest.model;
  if (sha256(readFileSync(path.join(root, model.assetPath))) !== model.sha256) {
    throw Error("Existing Android VAD asset does not match its frozen manifest");
  }
  const output = path.resolve(env.OUTPUT_ROOT || path.join(root, ".cache/android-candidates", input.candidateId));
  if (existsSync(output)) throw Error("Candidate output already exists; never overwrite an earlier candidate");
  mkdirSync(output, { recursive: true, mode: 0o700 });
  const flutter = env.FLUTTER_BIN || "flutter";
  const buildArgs = ["build", "apk", "--release", "--split-per-abi", `--target-platform=${input.targetPlatform}`,
    "--no-pub", `--build-name=${input.version}`, `--build-number=${input.buildNumber}`,
    `--dart-define-from-file=${profilePath}`,
    ...Object.entries(androidCandidateDefines(input)).map(([key, value]) => `--dart-define=${key}=${value}`)];
  // Refresh generated registration in Release mode before actual compilation.
  // Never ship the dev-only IntegrationTestPlugin or hand-edit the registrant.
  execute(flutter, [...buildArgs, "--config-only"], { cwd: mobile, log: path.join(output, "config-only") });
  execute(flutter, buildArgs, { cwd: mobile, log: path.join(output, "release-build") });
  requireCleanSource(source);
  const apk = path.join(mobile, "build/app/outputs/flutter-apk", `app-${input.abi}-release.apk`);
  const analyzer = env.APKANALYZER || "apkanalyzer", signer = env.APKSIGNER || "apksigner";
  const readManifest = command => execute(analyzer, ["manifest", command, apk]).trim();
  const signerOutput = execute(signer, ["verify", "--verbose", "--print-certs", apk], {
    log: path.join(output, "apk-signature"),
  });
  const actual = { applicationId: readManifest("application-id"), versionName: readManifest("version-name"),
    versionCode: readManifest("version-code"), debuggable: readManifest("debuggable"),
    manifestXml: readManifest("print"), signerOutput };
  assertAndroidApkIdentity(input, actual);
  const packedModel = execute("unzip", ["-p", apk, "assets/models/silero_vad_v6.2.3.onnx"], { encoding: null });
  if (packedModel.length !== model.bytes || sha256(packedModel) !== model.sha256) {
    throw Error("Packaged Android VAD asset differs from the frozen source asset");
  }
  const notice = readFileSync(path.join(mobile, "android/app/src/main/assets/models/SILERO_NOTICE.txt"));
  const packedNotice = execute("unzip", ["-p", apk, "assets/models/SILERO_NOTICE.txt"], { encoding: null });
  if (!notice.equals(packedNotice)) throw Error("Packaged VAD attribution differs from the source notice");
  requireCleanSource(source);
  const archivedApk = path.join(output, `wujie-public-${input.abi}.apk`);
  copyFileSync(apk, archivedApk, constants.COPYFILE_EXCL);
  const apkSha256 = sha256(readFileSync(apk));
  if (sha256(readFileSync(archivedApk)) !== apkSha256) throw Error("Archived APK differs from the inspected APK");
  writeFileSync(path.join(output, "candidate-manifest.json"), JSON.stringify({
    schemaVersion:1, kind:"android_public_signed_candidate", ...input, sourceState:"clean",
    localProfile:JSON.parse(profileBytes), apkFile:path.basename(archivedApk), apkSha256,
    nativeNamespace:"com.example.translation_mobile", launcher:"com.example.translation_mobile.MainActivity",
    vad:{provider:modelManifest.provider,sha256:model.sha256,bytes:model.bytes,
      noticeSha256:sha256(notice),runtime:modelManifest.runtime},
    buildEvidence:{releaseCompiled:true,apkIdentityMatched:true,signatureVerified:true},
    modelResourcesOnDevice:"not_verified", deviceVerified:false, installed:false,
    sameSourceServerQualified:false, releaseAccepted:false,
  }, null, 2) + "\n", { flag:"wx", mode:0o600 });
  console.log(`Signed Android candidate archived at ${output}; no device or service acceptance claimed.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
