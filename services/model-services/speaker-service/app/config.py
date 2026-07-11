import os
from dataclasses import dataclass
from typing import Literal


SpeakerProvider = Literal["mock", "sortformer_shadow"]


@dataclass(frozen=True)
class SpeakerConfig:
    provider: SpeakerProvider
    model_id: str
    api_key: str | None
    inference_interval_ms: int
    stabilization_ms: int
    max_context_ms: int


def load_config() -> SpeakerConfig:
    provider = os.getenv("SPEAKER_MODEL_PROVIDER", "mock")
    if provider not in ("mock", "sortformer_shadow"):
        raise ValueError(f"Unsupported speaker provider: {provider}")
    return SpeakerConfig(
        provider=provider,
        model_id=os.getenv(
            "SPEAKER_MODEL_ID",
            "nvidia/diar_streaming_sortformer_4spk-v2.1",
        ),
        api_key=os.getenv("SPEAKER_SERVICE_API_KEY") or None,
        inference_interval_ms=int(os.getenv("SPEAKER_INFERENCE_INTERVAL_MS", "2240")),
        stabilization_ms=int(os.getenv("SPEAKER_STABILIZATION_MS", "800")),
        max_context_ms=int(os.getenv("SPEAKER_MAX_CONTEXT_MS", "120000")),
    )
