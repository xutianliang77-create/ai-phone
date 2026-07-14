from dataclasses import dataclass
import os


DEFAULT_VOXCPM2_MODEL_DIR = (
    "/data/models/translation-model-eval/data/tts-product-fit/models/openbmb_voxcpm2"
)


@dataclass(frozen=True)
class TtsConfig:
    provider: str = "mock"
    model_version: str = "mock-tts-v0.1.0"
    api_key: str = ""
    mock_sample_rate: int = 16000
    voxcpm2_model_dir: str = DEFAULT_VOXCPM2_MODEL_DIR
    voxcpm2_cfg_value: float = 2.0
    voxcpm2_inference_timesteps: int = 10
    voxcpm2_hifi_inference_timesteps: int = 15
    voxcpm2_load_denoiser: bool = False
    voice_reference_dir: str = ""
    voice_preset_manifest_path: str = ""


def load_config() -> TtsConfig:
    return TtsConfig(
        provider=os.getenv("TTS_SERVICE_PROVIDER", "mock"),
        model_version=os.getenv("TTS_MODEL_VERSION", "mock-tts-v0.1.0"),
        api_key=os.getenv("TTS_SERVICE_API_KEY", "").strip(),
        mock_sample_rate=int(os.getenv("TTS_MOCK_SAMPLE_RATE", "16000")),
        voxcpm2_model_dir=os.getenv("TTS_VOXCPM2_MODEL_DIR", DEFAULT_VOXCPM2_MODEL_DIR),
        voxcpm2_cfg_value=float(os.getenv("TTS_VOXCPM2_CFG_VALUE", "2.0")),
        voxcpm2_inference_timesteps=int(os.getenv("TTS_VOXCPM2_INFERENCE_TIMESTEPS", "10")),
        voxcpm2_hifi_inference_timesteps=int(
            os.getenv("TTS_VOXCPM2_HIFI_INFERENCE_TIMESTEPS", "15")
        ),
        voxcpm2_load_denoiser=env_bool("TTS_VOXCPM2_LOAD_DENOISER", False),
        voice_reference_dir=os.getenv("TTS_VOICE_REFERENCE_DIR", "").strip(),
        voice_preset_manifest_path=os.getenv("TTS_VOICE_PRESET_MANIFEST", "").strip(),
    )


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}
