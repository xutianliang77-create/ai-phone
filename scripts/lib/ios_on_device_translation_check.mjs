import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function checkIosOnDeviceTranslation(root) {
  const checks = [];
  requireContains(checks, root, "apps/mobile/lib/src/platform/translation/ios_system_translation_provider.dart", [
    ["translation_mobile/on_device_translation", "Dart MethodChannel name"],
    ["'isAvailable'", "Dart calls native availability"],
    ["'translate'", "Dart calls native translate"],
    ["'sourceLanguage': config.sourceLanguage", "Dart sends source language"],
    ["'targetLanguage': config.targetLanguage", "Dart sends target language"],
    ["MissingPluginException", "Dart falls back when native plugin is missing"],
    ["PlatformException", "Dart falls back when native translation is unavailable"],
  ]);
  requireContains(checks, root, "apps/mobile/ios/Runner/OnDeviceTranslationBridge.swift", [
    ["import Translation", "Swift imports Apple Translation framework"],
    ["methodChannelName = \"translation_mobile/on_device_translation\"", "Swift MethodChannel name"],
    ["case \"isAvailable\"", "Swift handles availability"],
    ["case \"translate\"", "Swift handles translate"],
    ["LanguageAvailability().status", "Swift checks installed language pair"],
    ["TranslationSession(", "Swift creates TranslationSession"],
    ["installedSource: pair.source", "Swift requires installed source language"],
    ["try await session.prepareTranslation()", "Swift prepares translation"],
    ["try await session.translate(text)", "Swift translates text"],
    ["Locale.Language(identifier: sourceCode)", "Swift maps source language"],
    ["Locale.Language(identifier: targetCode)", "Swift maps target language"],
    ["ios_translation_requires_ios_26", "Swift reports iOS version requirement"],
    ["language_pair_not_installed", "Swift reports missing language pair"],
  ]);
  requireContains(checks, root, "apps/mobile/ios/Runner/AppDelegate.swift", [
    ["OnDeviceTranslationBridge()", "AppDelegate creates translation bridge"],
    ["onDeviceTranslationBridge.register", "AppDelegate registers translation bridge"],
  ]);
  requireContains(checks, root, "scripts/lib/ios_nemotron_runtime_contract.mjs", [
    ["useLocalSessions: true", "runtime contract enables local sessions"],
    ["useOnDeviceTranslation: true", "runtime contract enables on-device translation"],
    ["onDeviceTranslationProvider: \"ios_system\"", "runtime contract selects iOS system translation"],
    ["onDeviceTranslationRequired: true", "runtime contract requires local on-device translation"],
  ]);

  const failures = checks.filter((check) => !check.pass);
  return {
    schemaVersion: 1,
    status: failures.length === 0 ? "ready" : "not_ready",
    checks,
    failures,
  };
}

function requireContains(checks, root, relativePath, definitions) {
  const file = path.join(root, relativePath);
  const content = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (!content) {
    checks.push({
      file: relativePath,
      label: "file exists",
      pass: false,
      issue: `${relativePath} is missing or empty`,
    });
    return;
  }
  for (const [needle, label] of definitions) {
    const pass = content.includes(needle);
    checks.push({
      file: relativePath,
      label,
      pass,
      issue: pass ? null : `${relativePath} missing ${needle}`,
    });
  }
}
