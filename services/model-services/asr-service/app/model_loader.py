from typing import Protocol

from app.config import AsrConfig
from app.firered_engine import FireRedAsr2AedEngine
from app.endpoint_policy import EndpointPolicy
from app.mock_engine import MockAsrEngine
from app.qwen3_engine import Qwen3AsrEngine
from app.qwen3_hf_engine import LocalQwen3HfAsrRunner
from app.schemas import LanguageCode, TranslationLanguageCode
from app.schemas import AsrTranscribeRequest, AsrTranscribeResponse
from app.sensevoice_engine import SenseVoiceEngine
from app.vad import create_vad_provider


class AsrEngine(Protocol):
    async def transcribe(
        self,
        request: AsrTranscribeRequest,
    ) -> AsrTranscribeResponse | None:
        ...

    async def flush(
        self,
        session_id: str,
        source_language: LanguageCode,
        target_language: TranslationLanguageCode,
    ) -> AsrTranscribeResponse | None:
        ...

    async def commit_boundary(
        self,
        session_id: str,
        boundary_ms: int,
        source_language: LanguageCode,
        target_language: TranslationLanguageCode,
    ) -> AsrTranscribeResponse | None:
        ...

    async def close_session(self, session_id: str) -> None:
        ...


def load_engine(config: AsrConfig) -> AsrEngine:
    if config.provider == "mock":
        return MockAsrEngine(emit_every_frames=config.mock_emit_every_frames)
    if config.provider == "sensevoice":
        vad_provider = load_vad_provider(config, config.sensevoice_vad_energy_threshold)
        return SenseVoiceEngine(
            model_dir=config.sensevoice_model,
            device=config.sensevoice_device,
            min_audio_ms=config.sensevoice_min_audio_ms,
            endpoint_silence_ms=config.sensevoice_endpoint_silence_ms,
            max_audio_ms=config.sensevoice_max_audio_ms,
            preroll_ms=config.sensevoice_preroll_ms,
            vad_energy_threshold=config.sensevoice_vad_energy_threshold,
            vad_provider=vad_provider,
        )
    if config.provider == "fireredasr2_aed":
        vad_provider = load_vad_provider(config, config.firered_vad_energy_threshold)
        return FireRedAsr2AedEngine(
            model_dir=config.firered_model_dir,
            use_gpu=config.firered_use_gpu,
            beam_size=config.firered_beam_size,
            min_audio_ms=config.firered_min_audio_ms,
            endpoint_silence_ms=config.firered_endpoint_silence_ms,
            max_audio_ms=config.firered_max_audio_ms,
            preroll_ms=config.firered_preroll_ms,
            vad_energy_threshold=config.firered_vad_energy_threshold,
            vad_provider=vad_provider,
        )
    if config.provider == "qwen3_asr":
        vad_provider = load_vad_provider(config, config.qwen3_vad_energy_threshold)
        return Qwen3AsrEngine(
            model_dir=config.qwen3_model_dir,
            dtype=config.qwen3_dtype,
            device_map=config.qwen3_device_map,
            max_inference_batch_size=config.qwen3_max_inference_batch_size,
            max_new_tokens=config.qwen3_max_new_tokens,
            min_audio_ms=config.qwen3_min_audio_ms,
            endpoint_silence_ms=config.qwen3_endpoint_silence_ms,
            max_audio_ms=config.qwen3_max_audio_ms,
            preroll_ms=config.qwen3_preroll_ms,
            vad_energy_threshold=config.qwen3_vad_energy_threshold,
            context=config.qwen3_context,
            english_context=config.qwen3_english_context,
            mixed_language_retry_enabled=config.qwen3_mixed_language_retry_enabled,
            vad_provider=vad_provider,
            endpoint_policies=qwen3_endpoint_policies(config),
        )
    if config.provider == "qwen3_asr_hf":
        vad_provider = load_vad_provider(config, config.qwen3_vad_energy_threshold)
        return Qwen3AsrEngine(
            model_dir=config.qwen3_model_dir,
            dtype=config.qwen3_dtype,
            device_map=config.qwen3_device_map,
            max_inference_batch_size=config.qwen3_max_inference_batch_size,
            max_new_tokens=config.qwen3_max_new_tokens,
            min_audio_ms=config.qwen3_min_audio_ms,
            endpoint_silence_ms=config.qwen3_endpoint_silence_ms,
            max_audio_ms=config.qwen3_max_audio_ms,
            preroll_ms=config.qwen3_preroll_ms,
            vad_energy_threshold=config.qwen3_vad_energy_threshold,
            context=config.qwen3_context,
            english_context=config.qwen3_english_context,
            mixed_language_retry_enabled=config.qwen3_mixed_language_retry_enabled,
            vad_provider=vad_provider,
            endpoint_policies=qwen3_endpoint_policies(config),
            runner=LocalQwen3HfAsrRunner(
                model_dir=config.qwen3_model_dir,
                dtype=config.qwen3_dtype,
                device_map=config.qwen3_device_map,
                max_new_tokens=config.qwen3_max_new_tokens,
            ),
        )
    raise ValueError(f"Unsupported ASR provider: {config.provider}")


def load_vad_provider(config: AsrConfig, fallback_energy_threshold: int):
    return create_vad_provider(
        provider=config.vad_provider,
        model_path=config.vad_model_path,
        assets_path=config.vad_assets_path,
        threshold=config.vad_threshold,
        window_ms=config.vad_window_ms,
        smoothing_frames=config.vad_smoothing_frames,
        fallback_energy_threshold=fallback_energy_threshold,
    )


def qwen3_endpoint_policies(config: AsrConfig):
    silence_by_mode = {
        "conversation": config.qwen3_conversation_endpoint_silence_ms,
        "listening": config.qwen3_listening_endpoint_silence_ms,
        "call_link": config.qwen3_call_link_endpoint_silence_ms,
        "pstn": config.qwen3_pstn_endpoint_silence_ms,
    }
    return {
        mode: EndpointPolicy(
            mode=mode,
            min_audio_ms=config.qwen3_min_audio_ms,
            endpoint_silence_ms=silence_ms,
            max_audio_ms=config.qwen3_max_audio_ms,
            preroll_ms=config.qwen3_preroll_ms,
        )
        for mode, silence_ms in silence_by_mode.items()
    }
