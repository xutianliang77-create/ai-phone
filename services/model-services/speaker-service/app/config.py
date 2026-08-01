import os
from dataclasses import dataclass
from typing import Literal


SpeakerProvider = Literal["mock", "sortformer", "sortformer_shadow"]


@dataclass(frozen=True)
class SpeakerConfig:
    provider: SpeakerProvider
    model_id: str
    api_key: str | None
    chunk_len: int
    chunk_left_context: int
    chunk_right_context: int
    fifo_len: int
    spkcache_update_period: int
    spkcache_len: int
    onset: float
    offset: float
    pad_offset_ms: int = 0
    min_duration_on_ms: int = 0
    min_duration_off_ms: int = 0
    voice_identity_provider: str = "off"
    voice_identity_model_id: str = (
        "/data/models/translation-model-eval/models/titanet/"
        "speakerverification_en_titanet_large.nemo"
    )
    voice_identity_store_dir: str = "/data/ai-phone/speaker-identities"
    voice_identity_encryption_key: str = ""
    session_alias_provider: str = "off"
    session_alias_model_id: str = (
        "/data/models/translation-model-eval/models/titanet/"
        "speakerverification_en_titanet_large.nemo"
    )
    session_alias_minimum_evidence_ms: int = 1500


def load_config() -> SpeakerConfig:
    provider = os.getenv("SPEAKER_MODEL_PROVIDER", "mock")
    if provider not in ("mock", "sortformer", "sortformer_shadow"):
        raise ValueError(f"Unsupported speaker provider: {provider}")
    session_alias_provider = os.getenv("SESSION_SPEAKER_ALIAS_PROVIDER", "off")
    if session_alias_provider not in ("off", "nemo_titanet"):
        raise ValueError(
            f"Unsupported session speaker alias provider: {session_alias_provider}",
        )
    return SpeakerConfig(
        provider=provider,
        model_id=os.getenv(
            "SPEAKER_MODEL_ID",
            "nvidia/diar_streaming_sortformer_4spk-v2.1",
        ),
        api_key=os.getenv("SPEAKER_SERVICE_API_KEY") or None,
        chunk_len=int(os.getenv("SPEAKER_CHUNK_LEN", "6")),
        chunk_left_context=int(os.getenv("SPEAKER_CHUNK_LEFT_CONTEXT", "1")),
        chunk_right_context=int(os.getenv("SPEAKER_CHUNK_RIGHT_CONTEXT", "7")),
        fifo_len=int(os.getenv("SPEAKER_FIFO_LEN", "188")),
        spkcache_update_period=int(os.getenv("SPEAKER_CACHE_UPDATE_PERIOD", "144")),
        spkcache_len=int(os.getenv("SPEAKER_CACHE_LEN", "188")),
        onset=float(os.getenv("SPEAKER_ONSET", "0.5")),
        offset=float(os.getenv("SPEAKER_OFFSET", "0.5")),
        pad_offset_ms=int(os.getenv("SPEAKER_PAD_OFFSET_MS", "0")),
        min_duration_on_ms=int(
            os.getenv("SPEAKER_MIN_DURATION_ON_MS", "0"),
        ),
        min_duration_off_ms=int(
            os.getenv("SPEAKER_MIN_DURATION_OFF_MS", "0"),
        ),
        voice_identity_provider=os.getenv("VOICE_IDENTITY_PROVIDER", "off"),
        voice_identity_model_id=os.getenv(
            "VOICE_IDENTITY_MODEL_ID",
            "/data/models/translation-model-eval/models/titanet/"
            "speakerverification_en_titanet_large.nemo",
        ),
        voice_identity_store_dir=os.getenv(
            "VOICE_IDENTITY_STORE_DIR",
            "/data/ai-phone/speaker-identities",
        ),
        voice_identity_encryption_key=os.getenv(
            "VOICE_IDENTITY_ENCRYPTION_KEY",
            "",
        ).strip(),
        session_alias_provider=session_alias_provider,
        session_alias_model_id=os.getenv(
            "SESSION_SPEAKER_ALIAS_MODEL_ID",
            "/data/models/translation-model-eval/models/titanet/"
            "speakerverification_en_titanet_large.nemo",
        ),
        session_alias_minimum_evidence_ms=int(
            os.getenv("SESSION_SPEAKER_ALIAS_MINIMUM_EVIDENCE_MS", "1500"),
        ),
    )
