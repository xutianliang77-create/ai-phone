export interface ModelProviderChoiceDto {
  provider: string;
  model: string;
  contract: string;
}

export interface ModelRoutingProfileDto {
  name: string;
  description?: string;
  asr: ModelProviderChoiceDto;
  translation: ModelProviderChoiceDto;
  tts: ModelProviderChoiceDto;
}

export interface ModelRoutingResponse {
  status: "ready" | "not_ready";
  activeProfile?: string;
  sourceFile?: string;
  profiles: ModelRoutingProfileDto[];
  issues: string[];
}
