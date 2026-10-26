import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
export const EXPECTED_ANDROID_CERTIFICATE_SUBJECT = "北京乾坤祥云科技有限公司";

export function androidSigningStatus(root, releaseProperties) {
  const names = ["storeFile", "storePassword", "keyAlias", "keyPassword"];
  const values = Object.fromEntries(names.map((name) => [name, androidReleaseValue(releaseProperties, name)]));
  const missing = names.filter((name) => !values[name]);
  const storeFileExists = Boolean(values.storeFile && androidStoreFilePath(root, values.storeFile));
  if (values.storeFile && !storeFileExists) missing.push("storeFileExists");
  return { ready: missing.length === 0, missing, storeFileExists };
}

export function androidCertificateSubjectStatus(root, releaseProperties, options) {
  const storeFile = androidReleaseValue(releaseProperties, "storeFile");
  const storePassword = androidReleaseValue(releaseProperties, "storePassword");
  const keyAlias = androidReleaseValue(releaseProperties, "keyAlias");
  const storeFilePath = storeFile ? androidStoreFilePath(root, storeFile) : "";
  if (!storeFile || !storePassword || !keyAlias || !storeFilePath) {
    return {
      ready: false,
      subject: "",
      issue: "Android release certificate subject cannot be checked without complete signing properties.",
    };
  }
  const reader = options.androidCertificateSubjectReader ?? readAndroidCertificateSubject;
  const result = reader({ storeFilePath, storePassword, keyAlias });
  if (!result.ok) {
    return {
      ready: false,
      subject: result.subject ?? "",
      issue: "Android release certificate subject could not be read.",
    };
  }
  const subject = result.subject ?? "";
  const ready = subject.includes(EXPECTED_ANDROID_CERTIFICATE_SUBJECT);
  return {
    ready,
    subject,
    issue: ready
      ? ""
      : `Android release certificate subject must include ${EXPECTED_ANDROID_CERTIFICATE_SUBJECT}.`,
  };
}

function readAndroidCertificateSubject({ storeFilePath, storePassword, keyAlias }) {
  const result = spawnSync("keytool", [
    "-list",
    "-v",
    "-keystore",
    storeFilePath,
    "-storepass",
    storePassword,
    "-alias",
    keyAlias,
  ], { encoding: "utf8" });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const subject = output.match(/(?:Owner|Subject):\s*([^\n]+)/)?.[1]?.trim() ?? "";
  return { ok: result.status === 0 && Boolean(subject), subject };
}

export function androidReleaseValue(releaseProperties, name) {
  return (process.env[androidReleaseEnvName(name)] || releaseProperties[name] || "").trim();
}

function androidReleaseEnvName(name) {
  return `TRANSLATION_ANDROID_${name.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`;
}

function androidStoreFilePath(root, storeFile) {
  if (path.isAbsolute(storeFile)) return existsSync(storeFile) ? storeFile : "";
  return [
    path.join(root, "apps/mobile/android", storeFile),
    path.join(root, "apps/mobile/android/app", storeFile),
  ].find((candidate) => existsSync(candidate)) ?? "";
}

