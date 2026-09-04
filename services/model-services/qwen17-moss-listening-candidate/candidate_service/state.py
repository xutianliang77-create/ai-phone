from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

import numpy as np


@dataclass(frozen=True)
class CandidateConfig:
    endpoint_silence_ms: int = 1400
    max_audio_ms: int = 10000
    preroll_ms: int = 400
    revision_preroll_ms: int = 1500
    vad_rms_threshold: float = 100
    minimum_readable_units: int = 2
    decode_schedule_ms: tuple[int, ...] = (500, 700, 900, 1000)
    steady_decode_ms: int = 1000


@dataclass
class Utterance:
    segment_id: str
    qwen_state: object
    start_ms: int
    audio: list[np.ndarray] = field(default_factory=list)
    final_audio: list[np.ndarray] = field(default_factory=list)
    samples: int = 0
    silence_ms: float = 0
    voiced_ms: float = 0
    max_speech_probability: float | None = None
    previous_decode: str = ""
    last_partial: str = ""
    next_revision: int = 0


@dataclass
class SessionState:
    session_id: str
    next_segment: int = 1
    utterance: Utterance | None = None
    preroll: deque[np.ndarray] = field(default_factory=deque)
    preroll_samples: int = 0
    revision_preroll: deque[np.ndarray] = field(default_factory=deque)
    revision_preroll_samples: int = 0
    responses: deque[dict[str, object]] = field(default_factory=deque)
    source_language: str = "auto"
    last_sequence: int = 0
    analyzed_frames: int = 0
    speech_frames: int = 0
    partials: int = 0
    finals: int = 0
    batch_finals: int = 0
    batch_final_fallbacks: int = 0
    last_batch_final_latency_ms: float | None = None


def endpoint_policy(config: CandidateConfig) -> dict[str, object]:
    return {
        "mode": "listening",
        "minAudioMs": 0,
        "endpointSilenceMs": config.endpoint_silence_ms,
        "maxAudioMs": config.max_audio_ms,
        "prerollMs": config.preroll_ms,
        "fingerprint": "0" * 64,
    }
