import type { TranslationLanguageCode } from "../shared/languages.js";

export type VoicePresetGender = "female" | "male" | "neutral";
export type VoicePresetTone = "natural" | "steady" | "lively";
export type VoicePresetScenario = "conversation" | "broadcast";
export type VoicePresetAccent =
  | "mandarin"
  | "sichuanese"
  | "northeastern_mandarin"
  | "cantonese"
  | "minnan"
  | "american_english"
  | "bilingual";

export interface VoicePresetDescriptor {
  id: string;
  labels: { zh: string; en: string };
  gender: VoicePresetGender;
  tone: VoicePresetTone;
  scenario: VoicePresetScenario;
  accent: VoicePresetAccent;
  languages: TranslationLanguageCode[];
  provider: string;
  model: string;
  version: string;
}

export interface VoicePresetCatalogResponse {
  version: string;
  defaultPresetId?: string;
  presets: VoicePresetDescriptor[];
}
