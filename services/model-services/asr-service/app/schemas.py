from typing import Literal

from pydantic import BaseModel, Field


LanguageCode = str
TranslationLanguageCode = str
AudioFormat = Literal["pcm16"]
AsrEndpointMode = Literal["conversation", "listening", "call_link", "pstn"]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: Literal["asr-service"]
    provider: str
    modelVersion: str
    vadProvider: str
    vadThreshold: float
    vadConfiguredProvider: str
    vadFallbackReason: str | None = None
    vadModelFingerprint: str | None = None


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
    mode: AsrEndpointMode = "conversation"
    hotwords: list[str] = Field(default_factory=list, max_length=200)
    corrections: list[AsrCorrectionTerm] = Field(default_factory=list, max_length=80)


class AsrFlushRequest(BaseModel):
    sourceLanguage: LanguageCode
    targetLanguage: TranslationLanguageCode
    mode: AsrEndpointMode = "conversation"
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


class AsrEndpointPolicyDiagnostics(BaseModel):
    mode: AsrEndpointMode
    minAudioMs: int = Field(ge=0)
    endpointSilenceMs: int = Field(ge=0)
    maxAudioMs: int = Field(gt=0)
    prerollMs: int = Field(ge=0)
    fingerprint: str


class VadDiagnosticsResponse(BaseModel):
    configuredProvider: Literal["marblenet", "rms"]
    activeProvider: Literal["marblenet", "rms", "rms_fallback"]
    threshold: float = Field(ge=0, le=1)
    analyzedFrameCount: int = Field(ge=0)
    speechFrameCount: int = Field(ge=0)
    speechFrameRatio: float = Field(ge=0, le=1)
    probabilityMin: float | None = Field(default=None, ge=0, le=1)
    probabilityMax: float | None = Field(default=None, ge=0, le=1)
    probabilityMean: float | None = Field(default=None, ge=0, le=1)
    fallbackCount: int = Field(ge=0)
    fallbackReason: Literal[
        "assets_missing", "load_failed", "runtime_failed"
    ] | None = None
    modelFingerprint: str | None = None
    endpointPolicy: AsrEndpointPolicyDiagnostics
