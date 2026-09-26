// Candidate-only contracts. Importing this module does not build, probe a
// device/service, read signing secrets, or generate a key.
export const androidLocalProfile = Object.freeze({
  USE_DEVICE_ASR: "true", DEVICE_ASR_PROVIDER: "android_system",
  USE_ON_DEVICE_TRANSLATION: "true", ON_DEVICE_TRANSLATION_PROVIDER: "android_mlkit",
  ON_DEVICE_TRANSLATION_REQUIRED: "true", USE_LOCAL_SESSIONS: "true",
  SERVER_OWNED_HISTORY: "false", DEVICE_ASR_VAD_PROVIDER: "silero_onnx",
  DEVICE_ASR_AUTO_DOWNLOAD_MODEL: "false", DEVICE_ASR_DIAGNOSTIC_CAPTURE: "false",
  ENABLE_DEVICE_SPEAKER: "false", USE_MOCK_AUDIO: "false",
});

const targetAbis = {
  "android-arm64": "arm64-v8a", "android-arm": "armeabi-v7a", "android-x64": "x86_64",
};
const validId = value => /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(value) &&
  !/^(com\.(example|yourcompany)\.|com\.wujieai\.androidtest$)/.test(value);

export function androidCandidateInputs(env, source, profile, profileSha256) {
  for (const [key, value] of Object.entries(androidLocalProfile)) {
    if (profile[key] !== value) throw Error(`Android local profile mismatch: ${key}`);
  }
  if (Object.keys(profile).length !== Object.keys(androidLocalProfile).length) {
    throw Error("Android local profile contains unexpected defines");
  }
  if (![source.commit, source.tree].every(value => /^[a-f0-9]{40}$/.test(value)) ||
      !/^[a-f0-9]{64}$/.test(profileSha256)) throw Error("Clean source/profile identity is required");
  const applicationId = required(env, "PUBLIC_ANDROID_APPLICATION_ID");
  if (!validId(applicationId) || applicationId === env.PRIVATE_ANDROID_APPLICATION_ID) {
    throw Error("Public Android applicationId must be approved and distinct from private/test identity");
  }
  const deploymentId = required(env, "PUBLIC_DEPLOYMENT_ID");
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(deploymentId)) throw Error("Invalid public deployment identity");
  const baseUrl = new URL(required(env, "SERVER_BASE_URL"));
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash ||
      ["localhost", "0.0.0.0", "[::1]", "[::]"].includes(baseUrl.hostname) ||
      /^127\./.test(baseUrl.hostname)) throw Error("A device-reachable HTTPS server URL is required");
  const version = env.APP_VERSION || "1.1.0";
  if (version !== "1.1.0") throw Error("Android public profile version must be 1.1.0");
  const buildNumber = required(env, "BUILD_NUMBER");
  if (!/^[1-9][0-9]{0,9}$/.test(buildNumber) || Number(buildNumber) > 2_100_000_000) {
    throw Error("BUILD_NUMBER must be a positive Android versionCode at most 2100000000");
  }
  const candidateId = env.CANDIDATE_ID || `wujie-android-${source.commit.slice(0, 7)}-${buildNumber}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(candidateId)) throw Error("Invalid candidate ID");
  const targetPlatform = env.TARGET_PLATFORM || "android-arm64";
  if (!Object.hasOwn(targetAbis, targetPlatform)) throw Error("One supported Android target platform is required");
  const signerSha256 = required(env, "PUBLIC_ANDROID_CERT_SHA256").replaceAll(":", "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(signerSha256)) throw Error("Approved signing certificate SHA-256 is required");
  const sourceLanguage = env.SOURCE_LANGUAGE || "auto", targetLanguage = env.TARGET_LANGUAGE || "zh";
  const autoReverse = env.AUTO_REVERSE_TARGET_LANGUAGE || "true";
  if (!/^(auto|[a-z]{2,3}(-Hant)?)$/.test(sourceLanguage) ||
      !/^[a-z]{2,3}(-Hant)?$/.test(targetLanguage) || !["true", "false"].includes(autoReverse)) {
    throw Error("Invalid language selection");
  }
  const automaticPair = env.AUTOMATIC_LANGUAGE_PAIR || "";
  if (sourceLanguage === "auto" || autoReverse === "true" || automaticPair) {
    const pair = automaticPair.split(",");
    if (pair.length !== 2 || pair[0] === pair[1] || !pair.includes(targetLanguage) ||
        !pair.every(code => /^[a-z]{2,3}(-Hant)?$/.test(code))) {
      throw Error("An explicit distinct automatic language pair containing the target is required");
    }
  }
  if (env.PRODUCT_PROFILE && env.PRODUCT_PROFILE !== "full") throw Error("Android delivery preserves the full product profile");
  return {
    applicationId, deploymentId, version, buildNumber, candidateId, signerSha256,
    targetPlatform, abi: targetAbis[targetPlatform], sourceCommit: source.commit, sourceTree: source.tree,
    serverBaseUrl: baseUrl.toString().replace(/\/$/, ""), profileSha256,
    sourceLanguage, targetLanguage, autoReverse, automaticPair, productProfile: "full", buildMode: "release",
  };
}

export function androidCandidateDefines(input) {
  return {
    APP_VERSION: input.version, BUILD_NUMBER: input.buildNumber, API_BASE_URL: input.serverBaseUrl,
    PUBLIC_DEPLOYMENT_ID: input.deploymentId, SOURCE_LANGUAGE: input.sourceLanguage,
    TARGET_LANGUAGE: input.targetLanguage, AUTO_REVERSE_TARGET_LANGUAGE: input.autoReverse,
    AUTOMATIC_LANGUAGE_PAIR: input.automaticPair, WUJIE_CANDIDATE_ID: input.candidateId,
    SOURCE_COMMIT: input.sourceCommit, SOURCE_TREE: input.sourceTree, SOURCE_STATE: "clean",
    WUJIE_PRODUCT_PROFILE: "full", ANDROID_LOCAL_PROFILE_SHA256: input.profileSha256,
  };
}

export function assertAndroidApkIdentity(input, actual) {
  if (actual.applicationId !== input.applicationId || actual.versionName !== input.version ||
      actual.versionCode !== input.buildNumber || actual.debuggable !== "false") {
    throw Error("APK identity/version or non-debuggable mode does not match candidate inputs");
  }
  const expectedMetadata = {
    WujieCandidateId: input.candidateId, WujieSourceCommit: input.sourceCommit,
    WujieSourceTree: input.sourceTree, WujieSourceState: "clean", WujieProductProfile: "full",
    WujieDeploymentId: input.deploymentId, WujieLocalProfileSha256: input.profileSha256,
  };
  for (const [name, value] of Object.entries(expectedMetadata)) {
    const entries = [...actual.manifestXml.matchAll(/<meta-data\b([^>]+)>/g)]
      .map(match => Object.fromEntries([...match[1].matchAll(/android:(name|value)="([^"]*)"/g)]
        .map(attribute => [attribute[1], attribute[2]])))
      .filter(entry => entry.name === name);
    if (entries.length !== 1 || entries[0].value !== value) throw Error(`APK metadata mismatch: ${name}`);
  }
  if (!/android:name="com\.example\.translation_mobile\.MainActivity"/.test(actual.manifestXml)) {
    throw Error("APK must use the original fully-qualified native launcher");
  }
  const certs = [...actual.signerOutput.matchAll(/^Signer #\d+ certificate SHA-256 digest:\s*([a-f0-9:]+)\s*$/gim)]
    .map(match => match[1].replaceAll(":", "").toLowerCase());
  if (certs.length !== 1 || certs[0] !== input.signerSha256 || /CN=Android Debug/i.test(actual.signerOutput)) {
    throw Error("APK signer does not match the approved non-debug certificate");
  }
}

function required(env, key) {
  const value = env[key];
  if (typeof value !== "string" || !value || value.trim() !== value || /[\r\n\0]/.test(value)) {
    throw Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}
