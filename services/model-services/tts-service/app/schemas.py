from typing import Literal

from pydantic import BaseModel, Field, model_validator


LanguageCode = Literal["zh", "en"]
SpeakerRole = Literal["host", "guest"]
AudioFormat = Literal["pcm16"]
SampleRate = Literal[16000, 24000]
VoiceMode = Literal["preset", "voice_design", "personal_clone", "ultimate_clone"]
VoiceGender = Literal["female", "male", "neutral"]
VoiceTone = Literal["natural", "steady", "lively"]
VoiceScenario = Literal["conversation", "broadcast"]
VoiceAccent = Literal[
    "mandarin",
    "sichuanese",
    "northeastern_mandarin",
    "cantonese",
    "minnan",
    "american_english",
    "bilingual",
]

VOICE_ID_PATTERN = r"^[A-Za-z0-9_-]{1,80}$"


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    service: Literal["tts-service"]
    provider: str
    modelVersion: str
    available: bool
    reason: str | None = None
    modelSampleRate: int | None = Field(default=None, ge=1)
    outputSampleRate: SampleRate | None = None
    voicePresetCatalogVersion: str | None = None
    availableVoicePresetCount: int = Field(default=0, ge=0)
    runtimeSignatureVersion: Literal[1] = 1
    runtimeFingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")


class TtsVoiceConfig(BaseModel):
    mode: VoiceMode = "preset"
    presetId: str | None = Field(default=None, pattern=VOICE_ID_PATTERN)
    voiceProfileId: str | None = Field(default=None, pattern=VOICE_ID_PATTERN)
    referenceAudioId: str | None = Field(default=None, pattern=VOICE_ID_PATTERN)
    referenceTranscript: str | None = Field(default=None, min_length=1, max_length=1000)
    controlPrompt: str | None = Field(default=None, min_length=1, max_length=240)
    quality: Literal["standard", "hifi"] = "standard"

    @model_validator(mode="after")
    def validate_voice_mode(self) -> "TtsVoiceConfig":
        if self.mode in {"personal_clone", "ultimate_clone"} and not self.referenceAudioId:
            raise ValueError("referenceAudioId is required for voice cloning")
        if self.mode == "ultimate_clone" and not self.referenceTranscript:
            raise ValueError("referenceTranscript is required for ultimate voice cloning")
        return self


class TtsSynthesizeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    language: LanguageCode
    speakerRole: SpeakerRole
    segmentId: str = Field(min_length=1)
    voice: TtsVoiceConfig | None = None


class TtsAudioPayload(BaseModel):
    format: AudioFormat = "pcm16"
    sampleRate: SampleRate
    data: str = Field(min_length=1)


class TtsSynthesizeResponse(BaseModel):
    provider: str
    model: str
    voiceMode: VoiceMode = "preset"
    voiceProfileId: str | None = None
    presetId: str | None = None
    firstAudioMs: int = Field(ge=0)
    audioDurationMs: int = Field(ge=1)
    modelSampleRate: int = Field(ge=1)
    outputSampleRate: SampleRate
    audio: TtsAudioPayload


class VoiceReferenceUploadRequest(BaseModel):
    audioBase64: str = Field(min_length=1)


class VoiceReferenceUploadResponse(BaseModel):
    status: Literal["ok"] = "ok"
    referenceAudioId: str
    bytes: int = Field(ge=1)


class VoicePresetDescriptor(BaseModel):
    id: str = Field(pattern=VOICE_ID_PATTERN)
    labels: dict[Literal["zh", "en"], str]
    gender: VoiceGender
    tone: VoiceTone
    scenario: VoiceScenario
    accent: VoiceAccent
    languages: list[LanguageCode]
    provider: str
    model: str
    version: str


class VoicePresetCatalogResponse(BaseModel):
    version: str
    defaultPresetId: str | None = None
    presets: list[VoicePresetDescriptor]
