from typing import Literal

from pydantic import BaseModel, Field


LanguageCode = str
TranslationLanguageCode = str
AudioFormat = Literal["pcm16"]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: Literal["asr-service"]
    provider: str
    modelVersion: str
    vadProvider: str
    vadThreshold: float


class AsrCorrectionTerm(BaseModel):
    fromText: str = Field(min_length=1, max_length=80)
    toText: str = Field(min_length=1, max_length=80)


class AsrTranscribeRequest(BaseModel):
    sessionId: str = Field(min_length=1)
    sequence: int = Field(ge=1)
    timestampMs: int = Field(ge=0)
    format: AudioFormat
    sampleRate: Literal[16000, 24000]
    data: str
    sourceLanguage: LanguageCode
    targetLanguage: TranslationLanguageCode
    hotwords: list[str] = Field(default_factory=list, max_length=200)
    corrections: list[AsrCorrectionTerm] = Field(default_factory=list, max_length=80)


class AsrFlushRequest(BaseModel):
    sourceLanguage: LanguageCode
    targetLanguage: TranslationLanguageCode
    hotwords: list[str] = Field(default_factory=list, max_length=200)
    corrections: list[AsrCorrectionTerm] = Field(default_factory=list, max_length=80)


class AsrBoundaryRequest(AsrFlushRequest):
    boundaryMs: int = Field(ge=0)


class AsrTranscribeResponse(BaseModel):
    segmentId: str
    text: str
    language: TranslationLanguageCode
    confidence: float | None = Field(default=None, ge=0, le=1)
    speaker: dict[str, object] | None = None
    timing: dict[str, object] | None = None
    endpointReason: Literal[
        "silence",
        "max_duration",
        "flush",
        "speaker_boundary",
    ] | None = None
