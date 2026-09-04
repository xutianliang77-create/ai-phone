from __future__ import annotations

import gc
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

from app.qwen3_prompt import qwen3_torch_dtype


@dataclass(frozen=True)
class AlignedToken:
    text: str
    start_ms: int
    end_ms: int
    confidence: float | None = None
    character_start: int | None = None
    character_end: int | None = None


class TranscriptForcedAligner(Protocol):
    def align(
        self,
        audio_path: str,
        text: str,
        language: str | None,
    ) -> tuple[AlignedToken, ...]: ...

    def shutdown(self) -> None: ...


class LocalQwen3ForcedAligner:
    def __init__(
        self,
        model_dir: str,
        dtype: str,
        device_map: str,
    ) -> None:
        import torch
        from qwen_asr import Qwen3ForcedAligner

        self._torch = torch
        self._aligner = Qwen3ForcedAligner.from_pretrained(
            model_dir,
            device_map=device_map,
            dtype=qwen3_torch_dtype(torch, dtype),
            low_cpu_mem_usage=True,
        )

    def align(
        self,
        audio_path: str,
        text: str,
        language: str | None,
    ) -> tuple[AlignedToken, ...]:
        audio, sample_rate = read_pcm16_wav(audio_path)
        result = self._aligner.align(
            audio=(audio, sample_rate),
            text=text,
            language=language,
        )[0]
        duration_ms = round(len(audio) / sample_rate * 1000)
        return validated_tokens(result, text, duration_ms)

    def shutdown(self) -> None:
        self._aligner = None
        gc.collect()
        if self._torch.cuda.is_available():
            self._torch.cuda.empty_cache()


def validated_tokens(
    result: object,
    transcript: str,
    duration_ms: int,
) -> tuple[AlignedToken, ...]:
    items = list(getattr(result, "items", ()) or ())
    tokens: list[AlignedToken] = []
    previous_start_ms = -1
    character_cursor = 0
    for item in items:
        text = str(getattr(item, "text", "") or "")
        start_ms = round(float(getattr(item, "start_time")) * 1000)
        end_ms = round(float(getattr(item, "end_time")) * 1000)
        if (
            not text.strip()
            or start_ms < 0
            or start_ms < previous_start_ms
            or end_ms < start_ms
            or end_ms > duration_ms + 250
        ):
            raise RuntimeError("Qwen forced alignment returned invalid timing")
        confidence = getattr(item, "confidence", None)
        if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
            confidence = None
        character_start = transcript.find(text, character_cursor)
        character_end = None
        if character_start >= 0:
            character_end = character_start + len(text)
            character_cursor = character_end
        tokens.append(AlignedToken(
            text=text,
            start_ms=start_ms,
            end_ms=end_ms,
            confidence=float(confidence) if confidence is not None else None,
            character_start=character_start if character_start >= 0 else None,
            character_end=character_end,
        ))
        previous_start_ms = start_ms
    return tuple(tokens)


def read_pcm16_wav(path: str) -> tuple[np.ndarray, int]:
    with wave.open(str(Path(path)), "rb") as handle:
        sample_rate = handle.getframerate()
        if handle.getnchannels() != 1 or handle.getsampwidth() != 2:
            raise RuntimeError("Forced aligner requires mono PCM16 WAV")
        pcm = handle.readframes(handle.getnframes())
    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
    return samples, sample_rate
