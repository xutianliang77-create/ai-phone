import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export function configureMobileReleaseIdentity(root, options) {
  const normalized = normalizeOptions(options);
  const issues = validateOptions(root, normalized);
  const files = plannedFiles(root, normalized);
  if (issues.length > 0) {
    return result("not_ready", issues, files, [], normalized);
  }
  if (normalized.dryRun) {
    return result("ready", [], files, [], normalized);
  }
  for (const file of files) writeText(file.path, file.content);
  return result("ready", [], files, files.map((file) => file.path), normalized);
}

function normalizeOptions(options) {
  const androidApplicationId = clean(options.androidApplicationId);
  return {
    iosBundleId: clean(options.iosBundleId),
    iosTeamId: clean(options.iosTeamId),
    androidApplicationId,
    androidNamespace: clean(options.androidNamespace) || androidApplicationId,
    androidStoreFile: clean(options.androidStoreFile),
    androidStorePassword: clean(options.androidStorePassword),
    androidKeyAlias: clean(options.androidKeyAlias),
    androidKeyPassword: clean(options.androidKeyPassword),
    companyName: clean(options.companyName),
    dryRun: Boolean(options.dryRun),
  };
}

function validateOptions(root, options) {
  const issues = [];
  if (!isIosBundleId(options.iosBundleId)) {
    issues.push("iOS bundle id must be a real reverse-DNS id and not com.example/com.yourcompany.");
  }
  if (!/^[A-Z0-9]{10}$/.test(options.iosTeamId) || isPlaceholder(options.iosTeamId)) {
    issues.push("iOS development team id must be a 10-character Apple Team ID.");
  }
  if (!isAndroidId(options.androidApplicationId)) {
    issues.push("Android applicationId must be a real lowercase reverse-DNS id.");
  }
  if (!isAndroidId(options.androidNamespace)) {
    issues.push("Android namespace must be a real lowercase reverse-DNS id.");
  }
  if (!options.androidStoreFile || !androidStoreFileExists(root, options.androidStoreFile)) {
    issues.push("Android storeFile must point to an existing release keystore.");
  }
  if (options.androidStorePassword.length < 6) {
    issues.push("Android storePassword must be at least 6 characters.");
  }
  if (!options.androidKeyAlias || isPlaceholder(options.androidKeyAlias)) {
    issues.push("Android keyAlias must be a real release key alias.");
  }
  if (options.androidKeyPassword.length < 6) {
    issues.push("Android keyPassword must be at least 6 characters.");
  }
  return issues;
}

function result(status, issues, files, written, options) {
  return {
    status,
    issues,
    files: redactFiles(files),
    written,
    androidCertificateDname: options.companyName ? androidCertificateDname(options.companyName) : "",
  };
}

function androidCertificateDname(companyName) {
  return `CN=${companyName}, O=${companyName}, C=CN`;
}

function plannedFiles(root, options) {
  return [
    {
      path: path.join(root, "apps/mobile/ios/Flutter/LocalIdentity.xcconfig"),
      content: [
        `TRANSLATION_IOS_BUNDLE_ID=${options.iosBundleId}`,
        `TRANSLATION_IOS_DEVELOPMENT_TEAM=${options.iosTeamId}`,
        "",
      ].join("\n"),
    },
    {
      path: path.join(root, "apps/mobile/android/key.properties"),
      content: [
        `applicationId=${options.androidApplicationId}`,
        `namespace=${options.androidNamespace}`,
        `storeFile=${options.androidStoreFile}`,
        `storePassword=${options.androidStorePassword}`,
        `keyAlias=${options.androidKeyAlias}`,
        `keyPassword=${options.androidKeyPassword}`,
        "",
      ].join("\n"),
    },
  ];
}

function isIosBundleId(value) {
  return /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(value) && !isPlaceholder(value);
}

function isAndroidId(value) {
  return /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(value) && !isPlaceholder(value);
}

function isPlaceholder(value) {
  return /(^com\.example\b|^com\.yourcompany\b|yourcompany|replace-with|YOURTEAMID)/i.test(value);
}

function androidStoreFileExists(root, storeFile) {
  if (path.isAbsolute(storeFile)) return existsSync(storeFile);
  return [
    path.join(root, "apps/mobile/android", storeFile),
    path.join(root, "apps/mobile/android/app", storeFile),
  ].some((candidate) => existsSync(candidate));
}

function redactFiles(files) {
  return files.map((file) => ({
    path: file.path,
    content: file.content
      .replace(/(storePassword=).+/g, "$1***")
      .replace(/(keyPassword=).+/g, "$1***"),
  }));
}

function writeText(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
