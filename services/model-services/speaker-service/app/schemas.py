from typing import Literal

from pydantic import BaseModel, Field


class SpeakerOptions(BaseModel):
    mode: Literal["auto", "diarization"]
    maxSpeakers: Literal[2, 3, 4] = 2
    allowVoiceIdentity: bool = False


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
    mode: Literal["contract", "shadow"]
