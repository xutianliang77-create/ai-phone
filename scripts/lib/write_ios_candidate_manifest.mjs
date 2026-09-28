import { writeFileSync } from "node:fs";
import path from "node:path";
import { verifyIosSymbolArchive } from "./archive_ios_candidate_symbols.mjs";

const output = process.argv[2];
if (!output) throw new Error("candidate manifest output path is required");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const manifest = {
  schemaVersion: 1,
  candidateId: required("CANDIDATE_ID"),
  sourceCommit: required("SOURCE_COMMIT"),
  sourceTree: required("SOURCE_TREE"),
  sourceState: "clean",
  bundleId: required("BUNDLE_ID"),
  version: required("APP_VERSION"),
  buildNumber: required("BUILD_NUMBER"),
  buildMode: required("BUILD_MODE"),
  productProfile: required("PRODUCT_PROFILE"),
  publicDeploymentId: required("PUBLIC_DEPLOYMENT_ID"),
  iosLocalProfileSha256: required("IOS_LOCAL_PROFILE_SHA256"),
  onlineEvidenceTrace: {enabled: process.env.ENABLE_ONLINE_EVIDENCE_TRACE === 'true',
    localMetadataOnly: true, pcmCaptured: false, maximumEventsPerNativeRecorder: 4096},
  ...(process.env.ENABLE_DEVICE_SPEAKER === "true" ? {deviceSpeaker: {
    enabledInCandidate: true, requiresServerRollout: true, anonymousOnly: true, maxSpeakers: 4,
    profile: "sortformer_v2_1_fastest", revision: "ae9a27ab45dc0aa3abede7d2d6bad2b7a69aa6d1"
  }} : {}),
  serverBaseUrl: required("SERVER_BASE_URL"),
  language: {
    source: required("SOURCE_LANGUAGE"),
    target: required("TARGET_LANGUAGE"),
    autoReverse: required("AUTO_REVERSE_TARGET_LANGUAGE") === "true",
    automaticPair: process.env.AUTOMATIC_LANGUAGE_PAIR || null,
  },
  appAggregateSha256: required("APP_SHA256"),
  appAggregateHashAlgorithm: process.env.APP_HASH_ALGORITHM || "legacy-absolute-file-list",
  signingIdentity: required("SIGNING_IDENTITY"),
  symbols: verifyIosSymbolArchive(
    path.join(path.dirname(output), "Runner.app"),
    path.join(path.dirname(output), "Symbols"),
  ),
  compatible: true,
  traceableSource: true,
};

writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
