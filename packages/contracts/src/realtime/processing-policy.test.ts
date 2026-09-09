import { describe, expect, it } from "vitest";
import { decideComponentProcessing, isLanguageSelection, resolveTranslationDirection } from "./processing-policy.js";
import type { ComponentProcessingRequest, LanguageSelection } from "./processing-policy.js";
import type { TranslationLanguageCode } from "../shared/languages.js";

const testScope = "asr/zh/conversation/r1"; // Public capability scope, not a credential.
const request = (): ComponentProcessingRequest => ({
  mode: "online", component: "asr", scopeKey: testScope,
  capability: {
    component: "asr", scopeKey: testScope, languageSupported: true,
    resourcesInstalled: true, runtimeAvailable: true, localQualification: { status: "qualified" },
  },
  networkAvailable: true, publicAccess: null,
});
function permit(r: ComponentProcessingRequest) {
  r.publicAccess = {
    component: r.component, scopeKey: r.scopeKey, allowedReasons: ["online_selected"],
    authenticated: true, consentValid: true, budgetAvailable: true, providerReady: true,
  };
}
function detected(language: TranslationLanguageCode, source: "acoustic" | "text" = "acoustic", qualified = true) {
  return { kind: "detected" as const, language, source, qualified };
}
const selection: LanguageSelection = {
  source: "auto", target: "en", autoReverse: true, pair: ["zh", "en"], revision: 3,
};

describe("component processing contract", () => {
  it.each(["asr", "translation", "tts"] as const)("routes online %s to public even when the phone is qualified", (component) => {
    const r = request(); r.component = component; r.capability!.component = component; permit(r);
    expect(decideComponentProcessing(r)).toEqual({ execution: "public", reason: "online_selected" });
  });
  it("does not require phone models or local qualification for online processing", () => {
    const r = request(); permit(r);
    r.capability!.localQualification = { status: "not_evaluated" };
    r.capability!.resourcesInstalled = false;
    r.capability!.runtimeAvailable = false;
    expect(decideComponentProcessing(r).execution).toBe("public");
    r.capability = null;
    expect(decideComponentProcessing(r).execution).toBe("public");
  });
  it("does not silently fall back to phone models when online access or network is unavailable", () => {
    const r = request();
    expect(decideComponentProcessing(r)).toMatchObject({ execution: "unavailable", blocker: "public_access_denied" });
    permit(r); r.networkAvailable = false;
    expect(decideComponentProcessing(r)).toMatchObject({ execution: "unavailable", blocker: "network_unavailable" });
    expect(r.mode).toBe("online");
  });
  it("still requires matching server permission, consent, budget and ready provider", () => {
    const r = request(); permit(r);
    for (const flag of ["authenticated", "consentValid", "budgetAvailable", "providerReady"] as const) {
      const denied = structuredClone(r); denied.publicAccess![flag] = false;
      expect(decideComponentProcessing(denied).execution).toBe("unavailable");
    }
    for (const patch of [{ component: "tts" as const }, { scopeKey: "another-language" }, { allowedReasons: [] }]) {
      const denied = structuredClone(r); Object.assign(denied.publicAccess!, patch);
      expect(decideComponentProcessing(denied).execution).toBe("unavailable");
    }
  });
  it("keeps qualified local work on device even when public access and network exist", () => {
    const r = request(); r.mode = "local"; permit(r);
    const before = structuredClone(r);
    expect(decideComponentProcessing(r)).toEqual({ execution: "device" });
    expect(r).toEqual(before);
    r.networkAvailable = false; r.publicAccess = null;
    expect(decideComponentProcessing(r)).toEqual({ execution: "device" });
  });
  it("never offloads local missing resources, runtime failure or an observed quality gap", () => {
    const r = request(); r.mode = "local"; permit(r);
    r.capability!.resourcesInstalled = false;
    expect(decideComponentProcessing(r)).toMatchObject({ reason: "resource_unavailable", blocker: "local_mode" });
    r.capability!.resourcesInstalled = true; r.capability!.runtimeAvailable = false;
    expect(decideComponentProcessing(r)).toMatchObject({ reason: "runtime_failure", blocker: "local_mode" });
    r.capability!.localQualification = { status: "verified_gap", reason: "qualified_quality_gap" };
    expect(decideComponentProcessing(r)).toMatchObject({ reason: "qualified_quality_gap", blocker: "local_mode" });
  });
  it("never treats installed resources as local qualification", () => {
    const r = request(); r.mode = "local"; permit(r);
    r.capability!.localQualification = { status: "not_evaluated" };
    expect(decideComponentProcessing(r)).toMatchObject({ reason: "qualification_pending" });
  });
  it("rejects a different local capability scope and contradictory metadata", () => {
    const r = request(); r.mode = "local";
    r.capability!.scopeKey = "another-language";
    expect(decideComponentProcessing(r)).toMatchObject({ blocker: "scope_mismatch" });
    r.capability!.scopeKey = r.scopeKey; r.capability!.component = "tts";
    expect(decideComponentProcessing(r)).toMatchObject({ blocker: "scope_mismatch" });
    r.capability!.component = "asr"; r.capability!.languageSupported = false;
    expect(decideComponentProcessing(r)).toMatchObject({ blocker: "capability_inconsistent" });
  });
  it("rejects an invalid mode instead of defaulting it to local", () => {
    const r = request(); permit(r);
    r.mode = "hybrid" as ComponentProcessingRequest["mode"];
    expect(decideComponentProcessing(r)).toMatchObject({ execution: "unavailable", reason: "invalid_processing_mode" });
  });
  it("does not accept truthy strings as trusted server permission flags", () => {
    const r = request(); permit(r);
    Object.assign(r.publicAccess!, { consentValid: "false" });
    expect(decideComponentProcessing(r)).toMatchObject({ blocker: "public_access_denied" });
  });
});

describe("language direction contract", () => {
  it("allows automatic source with a fixed target without inventing a reverse pair", () => {
    const fixed: LanguageSelection = { source: "auto", target: "ja", autoReverse: false, revision: 1 };
    expect(isLanguageSelection(fixed)).toBe(true);
    expect(resolveTranslationDirection(fixed, detected("fr"))).toMatchObject({ status: "ready", source: "fr", target: "ja" });
    expect(isLanguageSelection({ ...fixed, autoReverse: true })).toBe(false);
  });
  it("does not infer automatic language from a fixed locale hint", () => {
    expect(resolveTranslationDirection(selection, { kind: "unknown" })).toEqual({ status: "unresolved", reason: "source_unknown" });
    expect(resolveTranslationDirection(selection, { kind: "mixed", languages: ["zh", "en"] })).toEqual({ status: "unresolved", reason: "source_mixed" });
  });
  it("reverses according to the configured pair, including non-Chinese languages", () => {
    expect(resolveTranslationDirection({ ...selection, pair: ["fr", "ja"] }, detected("ja"))).toEqual({ status: "ready", source: "ja", target: "fr", revision: 3 });
    expect(resolveTranslationDirection(selection, detected("en"))).toMatchObject({ source: "en", target: "zh" });
  });
  it("preserves the explicit source/target without replacing user settings", () => {
    const fixed = { ...selection, source: "zh-Hant" as const, target: "en" as const, autoReverse: false };
    expect(resolveTranslationDirection(fixed, { kind: "unknown" })).toEqual({ status: "ready", source: "zh-Hant", target: "en", revision: 3 });
    expect(fixed.source).toBe("zh-Hant");
  });
  it("rejects invalid revisions, identical pairs and out-of-pair languages", () => {
    expect(resolveTranslationDirection({ ...selection, revision: NaN }, { kind: "unknown" })).toMatchObject({ reason: "invalid_revision" });
    expect(resolveTranslationDirection({ ...selection, pair: ["en", "en"] }, detected("en"))).toMatchObject({ reason: "invalid_pair" });
    expect(resolveTranslationDirection(selection, detected("fr"))).toMatchObject({ reason: "outside_pair" });
    expect(resolveTranslationDirection({ ...selection, source: "en", autoReverse: false }, { kind: "unknown" })).toMatchObject({ reason: "same_language" });
  });
  it("requires qualified text evidence and never treats a user hint as detection", () => {
    expect(resolveTranslationDirection(selection, { kind: "user_selected", language: "en" })).toMatchObject({ reason: "source_unknown" });
    expect(resolveTranslationDirection(selection, detected("en", "text", false))).toMatchObject({ reason: "source_unknown" });
    expect(resolveTranslationDirection(selection, detected("en", "text"))).toMatchObject({ status: "ready", source: "en", target: "zh" });
  });
  it("does not alternate for A/A/B and does not change the selected pair", () => {
    const before = structuredClone(selection);
    expect(["zh", "zh", "en"].map((language) => resolveTranslationDirection(selection, detected(language as TranslationLanguageCode))))
      .toMatchObject([{ target: "en" }, { target: "en" }, { target: "zh" }]);
    expect(selection).toEqual(before);
  });
  it("rejects malformed language selections instead of replacing them with Chinese-English", () => {
    for (const invalid of [null, [], { ...selection, pair: ["fr"] },
      { ...selection, pair: ["fr", "ja", "en"] }, { ...selection, revision: 0.5 },
      { ...selection, source: "invalid" }, { ...selection, target: "auto" }]) {
      expect(isLanguageSelection(invalid)).toBe(false);
    }
    expect(resolveTranslationDirection({ ...selection, target: "invalid" as TranslationLanguageCode }, detected("en")))
      .toMatchObject({ reason: "invalid_language" });
  });
});
