from dataclasses import dataclass
from hashlib import sha256
import os


@dataclass(frozen=True)
class AsrConfig:
    provider: str = "mock"
    api_key: str = ""
    metrics_bearer_token: str = ""
    mock_emit_every_frames: int = 8
    model_version: str = "mock-asr-v0.1.0"
    vad_provider: str = "rms"
    vad_model_path: str = ""
    vad_assets_path: str = ""
    vad_threshold: float = 0.5
    vad_window_ms: int = 1000
    vad_smoothing_frames: int = 3
    sensevoice_model: str = "iic/SenseVoiceSmall"
    sensevoice_device: str = "cpu"
    sensevoice_min_audio_ms: int = 1200
    sensevoice_endpoint_silence_ms: int = 600
    sensevoice_max_audio_ms: int = 8000
    sensevoice_preroll_ms: int = 200
    sensevoice_vad_energy_threshold: int = 350
    firered_model_dir: str = "/data/models/translation-model-eval/models/fireredasr2_aed"
    firered_use_gpu: bool = True
    firered_beam_size: int = 1
    firered_min_audio_ms: int = 1200
    firered_endpoint_silence_ms: int = 900
    firered_max_audio_ms: int = 8000
    firered_preroll_ms: int = 300
    firered_vad_energy_threshold: int = 350
    qwen3_model_dir: str = "/data/models/translation-model-eval/models/qwen3_asr_0_6b"
    qwen3_dtype: str = "bfloat16"
    qwen3_device_map: str = "cuda:0"
    qwen3_max_inference_batch_size: int = 1
    qwen3_max_new_tokens: int = 256
    qwen3_min_audio_ms: int = 1800
    qwen3_endpoint_silence_ms: int = 1100
    qwen3_conversation_endpoint_silence_ms: int = 900
    qwen3_listening_endpoint_silence_ms: int = 1400
    qwen3_call_link_endpoint_silence_ms: int = 900
    qwen3_pstn_endpoint_silence_ms: int = 1100
    qwen3_max_audio_ms: int = 10000
    qwen3_preroll_ms: int = 400
    qwen3_vad_energy_threshold: int = 350
    qwen3_context: str = ""
    qwen3_english_context: str = ""

    def runtime_parameters(self) -> dict[str, object]:
        common: dict[str, object] = {
            "vadProvider": self.vad_provider,
            "vadThreshold": self.vad_threshold,
            "vadWindowMs": self.vad_window_ms,
            "vadSmoothingFrames": self.vad_smoothing_frames,
        }
        if self.provider == "mock":
            return {**common, "emitEveryFrames": self.mock_emit_every_frames}
        if self.provider == "sensevoice":
            return {
                **common,
                "model": self.sensevoice_model,
                "device": self.sensevoice_device,
                "minAudioMs": self.sensevoice_min_audio_ms,
                "endpointSilenceMs": self.sensevoice_endpoint_silence_ms,
                "maxAudioMs": self.sensevoice_max_audio_ms,
                "prerollMs": self.sensevoice_preroll_ms,
                "vadEnergyThreshold": self.sensevoice_vad_energy_threshold,
            }
        if self.provider == "fireredasr2_aed":
            return {
                **common,
                "useGpu": self.firered_use_gpu,
                "beamSize": self.firered_beam_size,
                "minAudioMs": self.firered_min_audio_ms,
                "endpointSilenceMs": self.firered_endpoint_silence_ms,
                "maxAudioMs": self.firered_max_audio_ms,
                "prerollMs": self.firered_preroll_ms,
                "vadEnergyThreshold": self.firered_vad_energy_threshold,
            }
        return {
            **common,
            "dtype": self.qwen3_dtype,
            "deviceMap": self.qwen3_device_map,
            "maxInferenceBatchSize": self.qwen3_max_inference_batch_size,
            "maxNewTokens": self.qwen3_max_new_tokens,
            "minAudioMs": self.qwen3_min_audio_ms,
            "endpointSilenceMs": self.qwen3_endpoint_silence_ms,
            "endpointSilenceByMode": {
                "conversation": self.qwen3_conversation_endpoint_silence_ms,
                "listening": self.qwen3_listening_endpoint_silence_ms,
                "call_link": self.qwen3_call_link_endpoint_silence_ms,
                "pstn": self.qwen3_pstn_endpoint_silence_ms,
            },
            "maxAudioMs": self.qwen3_max_audio_ms,
            "prerollMs": self.qwen3_preroll_ms,
            "vadEnergyThreshold": self.qwen3_vad_energy_threshold,
            "contextSha256": _text_fingerprint(self.qwen3_context),
            "englishContextSha256": _text_fingerprint(self.qwen3_english_context),
        }


def load_config() -> AsrConfig:
    return AsrConfig(
        provider=os.getenv("ASR_SERVICE_PROVIDER", "mock"),
        api_key=os.getenv("ASR_SERVICE_API_KEY", "").strip(),
        metrics_bearer_token=os.getenv("METRICS_BEARER_TOKEN", "").strip(),
        mock_emit_every_frames=int(os.getenv("ASR_MOCK_EMIT_EVERY_FRAMES", "8")),
        model_version=os.getenv("ASR_MODEL_VERSION", "mock-asr-v0.1.0"),
        vad_provider=os.getenv("ASR_VAD_PROVIDER", "rms"),
        vad_model_path=os.getenv("ASR_VAD_MODEL_PATH", ""),
        vad_assets_path=os.getenv("ASR_VAD_ASSETS_PATH", ""),
        vad_threshold=float(os.getenv("ASR_VAD_THRESHOLD", "0.5")),
        vad_window_ms=int(os.getenv("ASR_VAD_WINDOW_MS", "1000")),
        vad_smoothing_frames=int(os.getenv("ASR_VAD_SMOOTHING_FRAMES", "3")),
        sensevoice_model=os.getenv("ASR_SENSEVOICE_MODEL", "iic/SenseVoiceSmall"),
        sensevoice_device=os.getenv("ASR_SENSEVOICE_DEVICE", "cpu"),
        sensevoice_min_audio_ms=int(os.getenv("ASR_SENSEVOICE_MIN_AUDIO_MS", "1200")),
        sensevoice_endpoint_silence_ms=int(
            os.getenv("ASR_SENSEVOICE_ENDPOINT_SILENCE_MS", "600")
        ),
        sensevoice_max_audio_ms=int(os.getenv("ASR_SENSEVOICE_MAX_AUDIO_MS", "8000")),
        sensevoice_preroll_ms=int(os.getenv("ASR_SENSEVOICE_PREROLL_MS", "200")),
        sensevoice_vad_energy_threshold=int(
            os.getenv("ASR_SENSEVOICE_VAD_ENERGY_THRESHOLD", "350")
        ),
        firered_model_dir=os.getenv(
            "ASR_FIRERED_MODEL_DIR",
            "/data/models/translation-model-eval/models/fireredasr2_aed",
        ),
        firered_use_gpu=os.getenv("ASR_FIRERED_USE_GPU", "true").lower() == "true",
        firered_beam_size=int(os.getenv("ASR_FIRERED_BEAM_SIZE", "1")),
        firered_min_audio_ms=int(os.getenv("ASR_FIRERED_MIN_AUDIO_MS", "1200")),
        firered_endpoint_silence_ms=int(
            os.getenv("ASR_FIRERED_ENDPOINT_SILENCE_MS", "900")
        ),
        firered_max_audio_ms=int(os.getenv("ASR_FIRERED_MAX_AUDIO_MS", "8000")),
        firered_preroll_ms=int(os.getenv("ASR_FIRERED_PREROLL_MS", "300")),
        firered_vad_energy_threshold=int(
            os.getenv("ASR_FIRERED_VAD_ENERGY_THRESHOLD", "350")
        ),
        qwen3_model_dir=os.getenv(
            "ASR_QWEN3_MODEL_DIR",
            "/data/models/translation-model-eval/models/qwen3_asr_0_6b",
        ),
        qwen3_dtype=os.getenv("ASR_QWEN3_DTYPE", "bfloat16"),
        qwen3_device_map=os.getenv("ASR_QWEN3_DEVICE_MAP", "cuda:0"),
        qwen3_max_inference_batch_size=int(
            os.getenv("ASR_QWEN3_MAX_INFERENCE_BATCH_SIZE", "1")
        ),
        qwen3_max_new_tokens=int(os.getenv("ASR_QWEN3_MAX_NEW_TOKENS", "256")),
        qwen3_min_audio_ms=int(os.getenv("ASR_QWEN3_MIN_AUDIO_MS", "1800")),
        qwen3_endpoint_silence_ms=int(
            os.getenv("ASR_QWEN3_ENDPOINT_SILENCE_MS", "1100")
        ),
        qwen3_conversation_endpoint_silence_ms=int(
            os.getenv("ASR_QWEN3_CONVERSATION_ENDPOINT_SILENCE_MS", "900")
        ),
        qwen3_listening_endpoint_silence_ms=int(
            os.getenv("ASR_QWEN3_LISTENING_ENDPOINT_SILENCE_MS", "1400")
        ),
        qwen3_call_link_endpoint_silence_ms=int(
            os.getenv("ASR_QWEN3_CALL_LINK_ENDPOINT_SILENCE_MS", "900")
        ),
        qwen3_pstn_endpoint_silence_ms=int(
            os.getenv("ASR_QWEN3_PSTN_ENDPOINT_SILENCE_MS", "1100")
        ),
        qwen3_max_audio_ms=int(os.getenv("ASR_QWEN3_MAX_AUDIO_MS", "10000")),
        qwen3_preroll_ms=int(os.getenv("ASR_QWEN3_PREROLL_MS", "400")),
        qwen3_vad_energy_threshold=int(
            os.getenv("ASR_QWEN3_VAD_ENERGY_THRESHOLD", "350")
        ),
        qwen3_context=os.getenv("ASR_QWEN3_CONTEXT", ""),
        qwen3_english_context=os.getenv("ASR_QWEN3_ENGLISH_CONTEXT", ""),
    )


def _text_fingerprint(value: str) -> str:
    return sha256(value.encode("utf-8")).hexdigest()
