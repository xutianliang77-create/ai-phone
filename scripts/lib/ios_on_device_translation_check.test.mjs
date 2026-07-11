import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { checkIosOnDeviceTranslation } from "./ios_on_device_translation_check.mjs";

let tempDir = null;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("checkIosOnDeviceTranslation", () => {
  test("passes when Flutter and Swift translation bridge evidence is present", () => {
    tempDir = makeProject();

    expect(checkIosOnDeviceTranslation(tempDir)).toMatchObject({
      status: "ready",
      failures: [],
    });
  });

  test("fails when the Swift bridge is still a stub", () => {
    tempDir = makeProject({
      swiftBridge: `
let methodChannelName = "translation_mobile/on_device_translation"
case "isAvailable": break
case "translate": break
`,
    });

    const result = checkIosOnDeviceTranslation(tempDir);

    expect(result.status).toBe("not_ready");
    expect(result.failures.map((failure) => failure.label)).toContain(
      "Swift imports Apple Translation framework",
    );
  });
});

function makeProject(overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "ios-translation-"));
  write(root, "apps/mobile/lib/src/platform/translation/ios_system_translation_provider.dart", `
	const MethodChannel('translation_mobile/on_device_translation');
	invokeMapMethod<String, Object?>('isAvailable', {});
	invokeMapMethod<String, Object?>('translate', {
  'sourceLanguage': config.sourceLanguage,
  'targetLanguage': config.targetLanguage,
});
MissingPluginException;
PlatformException;
`);
  write(root, "apps/mobile/ios/Runner/OnDeviceTranslationBridge.swift", overrides.swiftBridge ?? `
import Translation
let methodChannelName = "translation_mobile/on_device_translation"
case "isAvailable": break
case "translate": break
LanguageAvailability().status(from: pair.source, to: pair.target)
TranslationSession(installedSource: pair.source, target: pair.target)
installedSource: pair.source
try await session.prepareTranslation()
try await session.translate(text)
Locale.Language(identifier: sourceCode)
Locale.Language(identifier: targetCode)
"ios_translation_requires_ios_26"
"language_pair_not_installed"
`);
  write(root, "apps/mobile/ios/Runner/AppDelegate.swift", `
OnDeviceTranslationBridge()
onDeviceTranslationBridge.register(messenger: messenger)
`);
  write(root, "scripts/lib/ios_nemotron_runtime_contract.mjs", `
useOnDeviceTranslation: true
useLocalSessions: true
onDeviceTranslationProvider: "ios_system"
onDeviceTranslationRequired: true
`);
  return root;
}

function write(root, relativePath, content) {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}
