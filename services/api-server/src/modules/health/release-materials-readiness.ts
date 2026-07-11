import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  DOMESTIC_BASELINES,
  MIN_SCREENSHOT_COUNT,
  RELEASE_MATERIALS_CHECKED_ITEMS,
  type ReleaseMaterialsManifest,
} from "./release-materials-readiness-schema.js";
import { isSupportedScreenshotImage } from "./release-materials-screenshot-image.js";

export function getReleaseMaterialsReadiness() {
  const manifestPath = process.env.RELEASE_MATERIALS_FILE;
  if (!manifestPath) {
    return notReady(undefined, [
      "release materials missing RELEASE_MATERIALS_FILE",
    ]);
  }

  return getReleaseMaterialsReadinessForFile(manifestPath);
}

export function getReleaseMaterialsReadinessForFile(manifestPath: string) {
  const loaded = loadManifest(manifestPath);
  if (!loaded.ok) return notReady(manifestPath, [loaded.issue]);

  const issues = validateManifest(loaded.manifest, loaded.manifestDir);
  const warnings = warningNotes(loaded.manifest);
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    manifestPath,
    checkedItems: checkedItems(),
    issues,
    warnings,
  };
}

function loadManifest(manifestPath: string) {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false as const,
        issue: "release materials invalid manifest",
      };
    }
    return {
      ok: true as const,
      manifest: parsed as ReleaseMaterialsManifest,
      manifestDir: dirname(resolve(manifestPath)),
    };
  } catch {
    return {
      ok: false as const,
      issue: "release materials unreadable manifest",
    };
  }
}

function validateManifest(
  manifest: ReleaseMaterialsManifest,
  manifestDir: string,
) {
  return [
    ...requiredTextIssues(manifest),
    ...requiredUrlIssues(manifest),
    ...requiredListIssues(manifest, manifestDir),
    ...requiredBooleanIssues(manifest),
    ...requiredNumberIssues(manifest),
    ...placeholderIssues(manifest),
    ...appIcpFilingIssues(manifest),
    ...domesticBaselineIssues(manifest),
  ];
}

function requiredTextIssues(manifest: ReleaseMaterialsManifest) {
  const fields: Array<[keyof ReleaseMaterialsManifest, string]> = [
    ["appName", "app name"],
    ["bundleId", "iOS bundle id"],
    ["androidPackageId", "Android package id"],
    ["versionName", "version name"],
    ["shortDescription", "short description"],
    ["legalEntity", "legal entity"],
    ["customerSupportEmail", "customer support"],
    ["appIcpFiling", "APP ICP filing"],
    ["releaseOwner", "release owner"],
    ["rollbackPlan", "rollback plan"],
    ["grayReleasePlan", "gray release plan"],
  ];
  return fields
    .filter(([field]) => !hasText(manifest[field]))
    .map(([, label]) => `release materials missing ${label}`);
}

function requiredUrlIssues(manifest: ReleaseMaterialsManifest) {
  const fields: Array<[keyof ReleaseMaterialsManifest, string]> = [
    ["privacyPolicyUrl", "privacy policy url"],
    ["userAgreementUrl", "user agreement url"],
    ["refundPolicyUrl", "refund policy url"],
    ["accountDeletionUrl", "account deletion url"],
  ];
  return fields.flatMap(([field, label]) => {
    const value = manifest[field];
    if (!hasText(value)) return [`release materials missing ${label}`];
    return isHttpsUrl(value) ? [] : [`release materials invalid ${label}`];
  });
}

function requiredListIssues(
  manifest: ReleaseMaterialsManifest,
  manifestDir: string,
) {
  const fields: Array<[keyof ReleaseMaterialsManifest, string]> = [
    ["sdkList", "SDK list"],
    ["modelProviderList", "model provider list"],
    ["keywords", "keywords"],
    ["androidScreenshots", "Android screenshots"],
  ];
  const issues = fields
    .filter(([field]) => !hasList(manifest[field]))
    .map(([, label]) => `release materials missing ${label}`);
  const screenshotIssues = [
    ...screenshotCountIssues(manifest.androidScreenshots, "Android"),
    ...screenshotCountIssues(iosScreenshotList(manifest), "iOS"),
    ...screenshotPathIssues(
      manifest.androidScreenshots,
      manifestDir,
      "Android",
    ),
    ...iosScreenshotPathIssues(manifest, manifestDir),
  ];
  const missingIssues = hasIosScreenshotSet(manifest)
    ? issues
    : [...issues, "release materials missing iOS screenshots"];
  return [...missingIssues, ...screenshotIssues];
}

function screenshotCountIssues(screenshots: unknown, platform: string) {
  if (!hasList(screenshots) || screenshots.length >= MIN_SCREENSHOT_COUNT)
    return [];
  return [
    `release materials needs at least ${MIN_SCREENSHOT_COUNT} ${platform} screenshots`,
  ];
}

function requiredBooleanIssues(manifest: ReleaseMaterialsManifest) {
  const issues: string[] = [];
  if (manifest.privacyLabelsCompleted !== true) {
    issues.push("release materials privacy labels not completed");
  }
  if (manifest.appStoreChinaReady !== true) {
    issues.push("release materials App Store China readiness not completed");
  }
  return issues;
}

function requiredNumberIssues(manifest: ReleaseMaterialsManifest) {
  const value = manifest.initialGrayPercent;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return ["release materials missing initial gray percent"];
  }
  if (value < 1 || value > 20) {
    return ["release materials invalid initial gray percent"];
  }
  return [];
}

function placeholderIssues(manifest: ReleaseMaterialsManifest) {
  const checks: Array<[unknown, string]> = [
    [manifest.appName, "app name"],
    [manifest.bundleId, "iOS bundle id"],
    [manifest.androidPackageId, "Android package id"],
    [manifest.versionName, "version name"],
    [manifest.shortDescription, "short description"],
    [manifest.legalEntity, "legal entity"],
    [manifest.customerSupportEmail, "customer support"],
    [manifest.releaseOwner, "release owner"],
    [manifest.rollbackPlan, "rollback plan"],
    [manifest.grayReleasePlan, "gray release plan"],
    [manifest.privacyPolicyUrl, "privacy policy url"],
    [manifest.userAgreementUrl, "user agreement url"],
    [manifest.refundPolicyUrl, "refund policy url"],
    [manifest.accountDeletionUrl, "account deletion url"],
  ];
  const issues = checks
    .filter(([value]) => hasText(value) && isPlaceholder(value))
    .map(([, label]) => `release materials placeholder ${label}`);
  if (
    hasText(manifest.customerSupportEmail) &&
    !isEmail(manifest.customerSupportEmail)
  ) {
    issues.push("release materials invalid customer support");
  }
  if (hasText(manifest.releaseOwner) && !isEmail(manifest.releaseOwner)) {
    issues.push("release materials invalid release owner");
  }
  return issues;
}

function appIcpFilingIssues(manifest: ReleaseMaterialsManifest) {
  if (!hasText(manifest.appIcpFiling)) return [];
  if (isAcceptedDraftAppIcp(manifest.appIcpFiling)) return [];
  if (isPlaceholder(manifest.appIcpFiling)) {
    return ["release materials placeholder APP ICP filing"];
  }
  return isAppIcpFiling(manifest.appIcpFiling)
    ? []
    : ["release materials invalid APP ICP filing"];
}

function warningNotes(manifest: ReleaseMaterialsManifest) {
  if (!isAcceptedDraftAppIcp(manifest.appIcpFiling)) return [];
  return [
    "release materials draft APP ICP filing accepted for development; replace before formal submission",
  ];
}

function domesticBaselineIssues(manifest: ReleaseMaterialsManifest) {
  return DOMESTIC_BASELINES.flatMap(([field, label, expected]) => {
    const actual = manifest[field];
    if (!hasText(actual) || actual === expected) return [];
    return [`release materials ${label} must match ${expected}`];
  });
}

function screenshotPathIssues(
  screenshots: unknown,
  manifestDir: string,
  platform: string,
) {
  if (!hasList(screenshots)) return [];
  return screenshots.flatMap((item) => {
    if (isInsecureRemoteUrl(item)) {
      return [`release materials invalid ${platform} screenshot url: ${item}`];
    }
    if (isHttpsUrl(item)) return [];
    const file = resolveMaterialPath(item, manifestDir);
    if (!existsSync(file)) {
      return [`release materials missing ${platform} screenshot file: ${item}`];
    }
    return isSupportedScreenshotImage(file)
      ? []
      : [`release materials invalid ${platform} screenshot image: ${item}`];
  });
}

function iosScreenshotPathIssues(
  manifest: ReleaseMaterialsManifest,
  manifestDir: string,
) {
  return screenshotPathIssues(iosScreenshotList(manifest), manifestDir, "iOS");
}

function iosScreenshotList(manifest: ReleaseMaterialsManifest) {
  if (hasList(manifest.iosScreenshots)) return manifest.iosScreenshots;
  if (hasList(manifest.iphoneScreenshots)) return manifest.iphoneScreenshots;
  return manifest.iosChinaScreenshots;
}

function checkedItems() {
  return RELEASE_MATERIALS_CHECKED_ITEMS;
}

function hasIosScreenshotSet(manifest: ReleaseMaterialsManifest) {
  return (
    hasList(manifest.iosScreenshots) ||
    hasList(manifest.iphoneScreenshots) ||
    hasList(manifest.iosChinaScreenshots)
  );
}

function hasList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpsUrl(value: unknown) {
  if (!hasText(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isInsecureRemoteUrl(value: string) {
  try {
    return new URL(value).protocol === "http:";
  } catch {
    return false;
  }
}

function resolveMaterialPath(value: string, manifestDir: string) {
  if (isAbsolute(value)) return value;
  const manifestRelativePath = resolve(manifestDir, value);
  if (existsSync(manifestRelativePath)) return manifestRelativePath;
  const projectRelativePath = resolve(manifestDir, "../..", value);
  return existsSync(projectRelativePath)
    ? projectRelativePath
    : resolve(process.cwd(), value);
}

function isPlaceholder(value: string) {
  return /example\.|localhost|translation\.local|com\.example|cn\.example|yourcompany|todo|待填|replace-with|00000000/i.test(
    value,
  );
}

function isAcceptedDraftAppIcp(value: unknown) {
  return hasText(value) && value.trim() === "京ICP备00000000号-1A";
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isAppIcpFiling(value: string) {
  return /^[\u4e00-\u9fa5]ICP备\d{8}号-\d+A$/.test(value);
}

function notReady(manifestPath: string | undefined, issues: string[]) {
  return {
    status: "not_ready",
    manifestPath,
    checkedItems: checkedItems(),
    issues,
    warnings: [],
  };
}
