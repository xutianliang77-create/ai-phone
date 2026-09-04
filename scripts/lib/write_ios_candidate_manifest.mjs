import { writeFileSync } from "node:fs";

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
  serverBaseUrl: required("SERVER_BASE_URL"),
  appAggregateSha256: required("APP_SHA256"),
  signingIdentity: required("SIGNING_IDENTITY"),
  compatible: true,
  traceableSource: true,
};

writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
