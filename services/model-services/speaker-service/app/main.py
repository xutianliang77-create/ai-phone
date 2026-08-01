from fastapi import FastAPI

from app.config import SpeakerConfig, load_config
from app.mock_engine import MockSpeakerEngine
from app.routes import create_router
from app.session_alias import (
    DisabledSessionSpeakerEmbeddingEngine,
    NemoSpeakerEmbedder,
    SessionSpeakerEmbeddingEngine,
)
from app.sortformer_shadow_engine import SortformerShadowEngine
from app.sortformer_streaming_runtime import StreamingProfile
from app.voice_identity import DisabledVoiceIdentityEngine, NemoVoiceIdentityEngine


def create_app(config: SpeakerConfig | None = None) -> FastAPI:
    resolved = config or load_config()
    engine = create_engine(resolved)
    app = FastAPI(title="ai phone Speaker Service", version="0.1.0")
    identity_engine = create_voice_identity_engine(resolved)
    alias_engine = create_session_alias_engine(resolved)
    app.include_router(create_router(
        engine,
        identity_engine,
        resolved,
        alias_engine,
    ))
    return app


def create_engine(config: SpeakerConfig):
    if config.provider in ("sortformer", "sortformer_shadow"):
        return SortformerShadowEngine(
            model_id=config.model_id,
            profile=StreamingProfile(
                chunk_len=config.chunk_len,
                chunk_left_context=config.chunk_left_context,
                chunk_right_context=config.chunk_right_context,
                fifo_len=config.fifo_len,
                spkcache_update_period=config.spkcache_update_period,
                spkcache_len=config.spkcache_len,
            ),
            onset=config.onset,
            offset=config.offset,
            pad_offset_ms=config.pad_offset_ms,
            min_duration_on_ms=config.min_duration_on_ms,
            min_duration_off_ms=config.min_duration_off_ms,
        )
    return MockSpeakerEngine()


def create_voice_identity_engine(config: SpeakerConfig):
    if config.voice_identity_provider == "nemo_titanet":
        engine = NemoVoiceIdentityEngine(
            config.voice_identity_model_id,
            config.voice_identity_store_dir,
            config.voice_identity_encryption_key,
        )
        engine.load()
        return engine
    return DisabledVoiceIdentityEngine()


def create_session_alias_engine(config: SpeakerConfig):
    if config.session_alias_provider == "nemo_titanet":
        embedder = NemoSpeakerEmbedder(config.session_alias_model_id)
        embedder.load()
        return SessionSpeakerEmbeddingEngine(
            embedder,
            config.session_alias_minimum_evidence_ms,
        )
    return DisabledSessionSpeakerEmbeddingEngine()


app = create_app()
