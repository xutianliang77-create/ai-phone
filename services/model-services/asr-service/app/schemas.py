from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator


LanguageCode = str
TranslationLanguageCode = str
AudioFormat = Literal["pcm16"]
AsrEndpointMode = Literal["conversation", "listening", "call_link", "pstn"]
StablePartialRejectionReason = Literal[
    "no_text",
    "insufficient_units",
    "duplicate_partial",
    "backtrack",
    "language_gate",
    "context_echo",
    "extension_pending",
]
StablePartialLanguageEvidence = Literal["empty", "zh", "en", "zh_en", "other"]
NonNegativeCount = Annotated[int, Field(ge=0)]


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
    externalBoundarySupported: bool
    runtimeSignatureVersion: Literal[1] = 1
    runtimeFingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")


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


class AsrTokenTiming(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    startMs: int = Field(ge=0)
    endMs: int = Field(ge=0)
    confidence: float | None = Field(default=None, ge=0, le=1)
    characterStart: int | None = Field(default=None, ge=0)
    characterEnd: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_ranges(self):
        if self.endMs < self.startMs:
            raise ValueError("token timing end precedes start")
        has_character_range = (
            self.characterStart is not None or self.characterEnd is not None
        )
        if has_character_range and (
            self.characterStart is None or self.characterEnd is None or
            self.characterEnd < self.characterStart
        ):
            raise ValueError("token timing character range is invalid")
        return self


class AsrTranscribeResponse(BaseModel):
    segmentId: str
    revision: int | None = Field(default=None, ge=0)
    isFinal: bool = True
    text: str
    language: TranslationLanguageCode
    confidence: float | None = Field(default=None, ge=0, le=1)
    speaker: dict[str, object] | None = None
    timing: dict[str, object] | None = None
    tokenTimings: list[AsrTokenTiming] | None = Field(
        default=None,
        max_length=2048,
    )
    endpointReason: Literal[
        "silence",
        "max_duration",
        "flush",
        "speaker_boundary",
        "device_vad",
    ] | None = None
    vadContext: dict[str, object] | None = None


class AsrEndpointPolicyDiagnostics(BaseModel):
    mode: AsrEndpointMode
    minAudioMs: int = Field(ge=0)
    endpointSilenceMs: int = Field(ge=0)
    maxAudioMs: int = Field(gt=0)
    prerollMs: int = Field(ge=0)
    vadThreshold: float | None = Field(default=None, ge=0, le=1)
    minVoicedMs: int = Field(ge=0)
    fingerprint: str


class StablePartialDiagnostics(BaseModel):
    enabled: bool
    policy: str = Field(min_length=1, max_length=80)
    eligibleSegmentCount: int = Field(ge=0)
    activeSegment: bool
    decodeCount: int = Field(ge=0)
    decisionCount: int = Field(ge=0)
    emittedCount: int = Field(ge=0)
    rejectionCounts: dict[StablePartialRejectionReason, NonNegativeCount] = Field(
        default_factory=dict
    )
    languageEvidenceSource: Literal["qwen_streaming_state_label"]
    languageEvidenceCounts: dict[
        StablePartialLanguageEvidence, NonNegativeCount
    ] = Field(default_factory=dict)
    languageGateCounts: dict[
        StablePartialLanguageEvidence, NonNegativeCount
    ] = Field(default_factory=dict)
    scheduledPushCount: int = Field(ge=0)
    completedPushCount: int = Field(ge=0)
    coalescedObservationCount: int = Field(ge=0)
    invalidatedPushCount: int = Field(ge=0)
    inFlight: bool
    resultReady: bool
    pendingAudioMs: float = Field(ge=0)
    maxPendingAudioMs: float = Field(ge=0)
    averagePushLatencyMs: float | None = Field(default=None, ge=0)
    maxPushLatencyMs: float | None = Field(default=None, ge=0)
    firstStablePartialLatencyMs: float | None = Field(default=None, ge=0)
    lastStablePartialLatencyMs: float | None = Field(default=None, ge=0)


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
    stablePartial: StablePartialDiagnostics | None = None
