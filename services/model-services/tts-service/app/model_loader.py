from typing import Protocol

from app.config import TtsConfig
from app.mock_engine import MockTtsEngine
from app.schemas import TtsSynthesizeRequest, TtsSynthesizeResponse
from app.voxcpm2_engine import VoxCpm2TtsEngine


class TtsEngine(Protocol):
    def health(self) -> tuple[bool, str | None]:
        ...

    def sample_rates(self) -> tuple[int | None, int]:
        ...

    async def synthesize(
        self,
        request: TtsSynthesizeRequest,
    ) -> TtsSynthesizeResponse:
        ...


def load_engine(config: TtsConfig) -> TtsEngine:
    if config.provider == "mock":
        return MockTtsEngine(sample_rate=config.mock_sample_rate)
    if config.provider == "voxcpm2":
        return VoxCpm2TtsEngine(
            model_dir=config.voxcpm2_model_dir,
            cfg_value=config.voxcpm2_cfg_value,
            inference_timesteps=config.voxcpm2_inference_timesteps,
            hifi_inference_timesteps=config.voxcpm2_hifi_inference_timesteps,
            load_denoiser=config.voxcpm2_load_denoiser,
            require_streaming=config.voxcpm2_require_streaming,
            voice_reference_dir=config.voice_reference_dir,
        )
    raise ValueError(f"Unsupported TTS provider: {config.provider}")
