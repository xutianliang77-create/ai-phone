import { writeFileSync } from "node:fs";

const output = process.argv[2];
if (!output) throw new Error("iOS identity xcconfig output path is required");

function required(name, pattern) {
  const value = process.env[name];
  if (!value || !pattern.test(value)) throw new Error(`${name} is missing or invalid`);
  return value;
}

const bundleId = required(
  "TRANSLATION_IOS_BUNDLE_ID",
  /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/u,
);
if (/^com\.(example|yourcompany)(\.|$)/iu.test(bundleId)) {
  throw new Error("TRANSLATION_IOS_BUNDLE_ID must not use a template identifier");
}
const developmentTeam = required("TRANSLATION_IOS_DEVELOPMENT_TEAM", /^[A-Z0-9]{10}$/u);
const candidateId = required("WUJIE_CANDIDATE_ID", /^[A-Za-z0-9._-]{1,96}$/u);
const sourceCommit = required("WUJIE_SOURCE_COMMIT", /^[a-f0-9]{40}$/u);
const sourceTree = required("WUJIE_SOURCE_TREE", /^[a-f0-9]{40}$/u);
const sourceState = required("WUJIE_SOURCE_STATE", /^clean$/u);
const productProfile = required(
  "WUJIE_PRODUCT_PROFILE",
  /^(core_translation|full)$/u,
);

writeFileSync(output, [
  `TRANSLATION_IOS_BUNDLE_ID=${bundleId}`,
  `TRANSLATION_IOS_DEVELOPMENT_TEAM=${developmentTeam}`,
  `WUJIE_CANDIDATE_ID=${candidateId}`,
  `WUJIE_SOURCE_COMMIT=${sourceCommit}`,
  `WUJIE_SOURCE_TREE=${sourceTree}`,
  `WUJIE_SOURCE_STATE=${sourceState}`,
  `WUJIE_PRODUCT_PROFILE=${productProfile}`,
  "",
].join("\n"), { mode: 0o600 });
