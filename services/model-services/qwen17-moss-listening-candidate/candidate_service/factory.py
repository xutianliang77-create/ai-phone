from __future__ import annotations

import os

from candidate_service.diagnostic_capture import DiagnosticCapture
from candidate_service.models import HttpMossRunner, LocalQwen17Runner
from candidate_service.runtime import CandidateEngine
from candidate_service.state import CandidateConfig
from candidate_service.vad import RmsVadProvider, create_marblenet_vad


def create_local_engine() -> CandidateEngine:
    config = CandidateConfig(
        endpoint_silence_ms=int(
            os.getenv("ASR_LISTENING_ENDPOINT_SILENCE_MS", "1400")
        ),
        max_audio_ms=int(os.getenv("ASR_LISTENING_MAX_AUDIO_MS", "10000")),
        preroll_ms=int(os.getenv("ASR_LISTENING_PREROLL_MS", "400")),
        revision_preroll_ms=int(
            os.getenv("ASR_LISTENING_REVISION_PREROLL_MS", "1500")
        ),
        vad_rms_threshold=float(
            os.getenv("ASR_LISTENING_VAD_RMS_THRESHOLD", "100")
        ),
    )
    qwen = LocalQwen17Runner(
        model_path=required_env("QWEN17_MODEL_PATH"),
        gpu_memory_utilization=float(
            os.getenv("QWEN17_GPU_MEMORY_UTILIZATION", "0.5")
        ),
        max_model_len=int(os.getenv("QWEN17_MAX_MODEL_LEN", "8192")),
        max_new_tokens=int(os.getenv("QWEN17_MAX_NEW_TOKENS", "64")),
        final_max_new_tokens=int(
            os.getenv("QWEN17_FINAL_MAX_NEW_TOKENS", "256")
        ),
        unfixed_chunk_num=int(os.getenv("QWEN17_UNFIXED_CHUNK_NUM", "7")),
        unfixed_token_num=int(os.getenv("QWEN17_UNFIXED_TOKEN_NUM", "5")),
        decode_schedule_ms=config.decode_schedule_ms,
        steady_decode_ms=config.steady_decode_ms,
    )
    qwen.prewarm()
    moss = HttpMossRunner(
        endpoint=required_env("MOSS_WORKER_URL"),
        api_key=required_env("MOSS_WORKER_API_KEY"),
        timeout_seconds=int(os.getenv("MOSS_WORKER_TIMEOUT_SECONDS", "15")),
    )
    vad_provider = os.getenv(
        "ASR_LISTENING_VAD_PROVIDER",
        "rms",
    ).strip().lower()
    if vad_provider == "marblenet":
        vad = create_marblenet_vad(
            model_path=required_env("ASR_LISTENING_VAD_MODEL_PATH"),
            assets_path=required_env("ASR_LISTENING_VAD_ASSETS_PATH"),
            threshold=float(
                os.getenv("ASR_LISTENING_VAD_THRESHOLD", "0.5")
            ),
            window_ms=int(
                os.getenv("ASR_LISTENING_VAD_WINDOW_MS", "1000")
            ),
            smoothing_frames=int(
                os.getenv("ASR_LISTENING_VAD_SMOOTHING_FRAMES", "3")
            ),
            fallback_rms_threshold=config.vad_rms_threshold,
        )
    elif vad_provider == "rms":
        vad = RmsVadProvider(config.vad_rms_threshold)
    else:
        raise RuntimeError(
            f"Unsupported ASR_LISTENING_VAD_PROVIDER: {vad_provider}"
        )
    diagnostic_capture = DiagnosticCapture(
        os.getenv("ASR_LISTENING_DIAGNOSTIC_CAPTURE_DIR", "").strip(),
        max_sessions=int(
            os.getenv("ASR_LISTENING_DIAGNOSTIC_CAPTURE_MAX_SESSIONS", "0")
        ),
        max_seconds=int(
            os.getenv("ASR_LISTENING_DIAGNOSTIC_CAPTURE_MAX_SECONDS", "60")
        ),
    )
    return CandidateEngine(qwen, moss, config, vad, diagnostic_capture)


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value
