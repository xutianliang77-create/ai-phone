import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

export function configureAndroidReleaseKeystore(root, options, runner = defaultRunner) {
  const normalized = normalizeOptions(root, options);
  const issues = validateOptions(normalized);
  if (issues.length > 0) return result("not_ready", issues, normalized, [], null);

  const keytoolCommand = buildKeytoolCommand(normalized);
  if (normalized.dryRun) return result("ready", [], normalized, [], keytoolCommand);

  mkdirSync(path.dirname(normalized.storeFilePath), { recursive: true });
  if (normalized.overwrite && existsSync(normalized.storeFilePath)) {
    rmSync(normalized.storeFilePath, { force: true });
  }
  const commandResult = runner(keytoolCommand.command, keytoolCommand.args);
  if (commandResult.status !== 0) {
    return result("not_ready", ["keytool failed to generate Android release keystore"], normalized, [], keytoolCommand);
  }
  writeText(normalized.keyPropertiesPath, keyPropertiesContent(normalized));
  return result("ready", [], normalized, [normalized.storeFilePath, normalized.keyPropertiesPath], keytoolCommand);
}

function normalizeOptions(root, options) {
  const storePassword = clean(options.storePassword) || randomSecret();
  const storeFile = clean(options.storeFile) || "release/domestic-release.jks";
  return {
    applicationId: clean(options.applicationId),
    namespace: clean(options.namespace) || clean(options.applicationId),
    storeFile,
    storeFileForProperties: storeFile,
    keyAlias: clean(options.keyAlias) || "domestic",
    storePassword,
    keyPassword: clean(options.keyPassword) || storePassword,
    companyName: clean(options.companyName) || "北京乾坤祥云科技有限公司",
    dryRun: Boolean(options.dryRun),
    overwrite: Boolean(options.overwrite),
    storeFilePath: resolveAndroidPath(root, storeFile),
    keyPropertiesPath: path.join(root, "apps/mobile/android/key.properties"),
  };
}

function validateOptions(options) {
  const issues = [];
  if (!isAndroidId(options.applicationId)) {
    issues.push("Android applicationId must be a real lowercase reverse-DNS id.");
  }
  if (!isAndroidId(options.namespace)) {
    issues.push("Android namespace must be a real lowercase reverse-DNS id.");
  }
  if (!options.companyName || isPlaceholder(options.companyName)) {
    issues.push("Android certificate company name must be a real legal entity.");
  }
  if (!options.keyAlias || isPlaceholder(options.keyAlias)) {
    issues.push("Android keyAlias must be a real release key alias.");
  }
  if (options.storePassword.length < 12) {
    issues.push("Android storePassword must be at least 12 characters.");
  }
  if (options.keyPassword.length < 12) {
    issues.push("Android keyPassword must be at least 12 characters.");
  }
  if (!options.overwrite && existsSync(options.storeFilePath)) {
    issues.push("Android release keystore already exists; pass --overwrite to replace it.");
  }
  return issues;
}

function buildKeytoolCommand(options) {
  return {
    command: "keytool",
    args: [
      "-genkeypair",
      "-v",
      "-keystore",
      options.storeFilePath,
      "-storepass",
      options.storePassword,
      "-keypass",
      options.keyPassword,
      "-alias",
      options.keyAlias,
      "-keyalg",
      "RSA",
      "-keysize",
      "2048",
      "-validity",
      "10000",
      "-dname",
      androidCertificateDname(options.companyName),
    ],
  };
}

function keyPropertiesContent(options) {
  return [
    `applicationId=${options.applicationId}`,
    `namespace=${options.namespace}`,
    `storeFile=${options.storeFileForProperties}`,
    `storePassword=${options.storePassword}`,
    `keyAlias=${options.keyAlias}`,
    `keyPassword=${options.keyPassword}`,
    "",
  ].join("\n");
}

function result(status, issues, options, written, keytoolCommand) {
  return {
    status,
    issues,
    written,
    storeFile: options.storeFilePath,
    keyPropertiesFile: options.keyPropertiesPath,
    keyAlias: options.keyAlias,
    applicationId: options.applicationId,
    namespace: options.namespace,
    androidCertificateDname: androidCertificateDname(options.companyName),
    generatedPasswords: {
      storePassword: "***",
      keyPassword: "***",
    },
    keytoolCommand: keytoolCommand ? redactKeytoolCommand(keytoolCommand) : null,
  };
}

function defaultRunner(command, args) {
  return spawnSync(command, args, { encoding: "utf8" });
}

function resolveAndroidPath(root, storeFile) {
  if (path.isAbsolute(storeFile)) return storeFile;
  return path.join(root, "apps/mobile/android", storeFile);
}

function androidCertificateDname(companyName) {
  return `CN=${companyName}, O=${companyName}, C=CN`;
}

function redactKeytoolCommand(keytoolCommand) {
  const args = keytoolCommand.args.map((arg, index, args) =>
    ["-storepass", "-keypass"].includes(args[index - 1]) ? "***" : arg
  );
  return { command: keytoolCommand.command, args };
}

function isAndroidId(value) {
  return /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(value) && !isPlaceholder(value);
}

function isPlaceholder(value) {
  return /(^com\.example\b|^com\.yourcompany\b|yourcompany|replace-with)/i.test(value);
}

function randomSecret() {
  return randomBytes(24).toString("base64url");
}

function writeText(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
