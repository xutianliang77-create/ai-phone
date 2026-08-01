from typing import Literal

from pydantic import BaseModel, Field, field_validator


class SpeakerOptions(BaseModel):
    mode: Literal["auto", "diarization"]
    maxSpeakers: Literal[2, 3, 4] = 4
    allowVoiceIdentity: bool = False

    @field_validator("maxSpeakers", mode="after")
    @classmethod
    def use_model_capacity(cls, _: int) -> int:
        return 4


class CreateSpeakerSessionRequest(BaseModel):
    sessionId: str = Field(min_length=1)
    options: SpeakerOptions


class SpeakerAudioFrame(BaseModel):
    type: Literal["audio.frame"]
    sessionId: str = Field(min_length=1)
    sequence: int = Field(ge=1)
    timestampMs: int = Field(ge=0)
    format: Literal["pcm16"]
    sampleRate: Literal[16000, 24000]
    data: str


class SpeakerSpan(BaseModel):
    speakerId: str
    startMs: int = Field(ge=0)
    endMs: int = Field(ge=0)
    confidence: float | None = Field(default=None, ge=0, le=1)
    overlap: bool = False
    final: bool = True


class SpeakerSpansResponse(BaseModel):
    spans: list[SpeakerSpan]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: Literal["speaker-service"]
    provider: str
    model: str
    mode: Literal["active", "contract", "shadow"]
    voiceIdentityProvider: str = "off"
    voiceIdentityAvailable: bool = False
    sessionAliasProvider: str = "off"
    sessionAliasAvailable: bool = False


class VoiceIdentityEnrollRequest(BaseModel):
    audioBase64: str = Field(min_length=1)


class VoiceIdentityEnrollResponse(BaseModel):
    embeddingRef: str


class VoiceIdentityMatchRequest(BaseModel):
    audioBase64: str = Field(min_length=1)
    candidateRefs: list[str] = Field(min_length=1, max_length=20)
    threshold: float = Field(default=0.72, ge=0.5, le=0.99)


class VoiceIdentityMatchResponse(BaseModel):
    embeddingRef: str | None = None
    confidence: float = Field(ge=0, le=1)


class SessionAliasObserveRequest(BaseModel):
    rawSpeakerId: str = Field(min_length=1)
    audioBase64: str = Field(min_length=1)
    overlap: bool = False


class SessionAliasObserveResponse(BaseModel):
    rawSpeakerId: str
    evidenceMs: int = Field(ge=0)
    eligible: bool
    similarities: dict[str, float]
