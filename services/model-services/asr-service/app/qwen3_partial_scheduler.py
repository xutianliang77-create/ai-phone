from __future__ import annotations

import asyncio
from dataclasses import dataclass
from time import monotonic
from typing import Callable

import numpy as np


@dataclass(frozen=True)
class PartialDecode:
    decode_id: int
    text: str
    model_language: str
    end_timestamp_ms: int
    latency_ms: float


@dataclass
class PartialPushMetrics:
    scheduled_count: int = 0
    completed_count: int = 0
    coalesced_observation_count: int = 0
    invalidated_count: int = 0
    active_count: int = 0
    max_pending_audio_ms: float = 0.0
    timed_count: int = 0
    total_latency_ms: float = 0.0
    max_latency_ms: float = 0.0


class LatestPartialPushScheduler:
    def __init__(
        self,
        push: Callable[..., tuple[int, str, str]],
        model_state: object,
        sample_rate: int,
        metrics: PartialPushMetrics,
    ) -> None:
        self._push = push
        self._model_state = model_state
        self._sample_rate = sample_rate
        self._metrics = metrics
        self._pending = bytearray()
        self._pending_end_timestamp_ms = 0
        self._task: asyncio.Task[PartialDecode] | None = None
        self._completed: PartialDecode | None = None
        self._error: BaseException | None = None
        self._invalidated = False

    def append(self, pcm: bytes, end_timestamp_ms: int) -> None:
        self.harvest()
        if pcm:
            if self._task is not None:
                self._metrics.coalesced_observation_count += 1
            self._pending.extend(pcm)
            self._pending_end_timestamp_ms = end_timestamp_ms

    def start(self) -> None:
        if (
            self._invalidated
            or self._task is not None
            or self._completed is not None
            or self._error is not None
            or not self._pending
        ):
            self._record_pending_highwater()
            return
        pcm = bytes(self._pending)
        self._pending.clear()
        task = asyncio.create_task(asyncio.to_thread(
            _push_audio,
            self._push,
            self._model_state,
            pcm,
            self._sample_rate,
            self._pending_end_timestamp_ms,
        ))
        self._task = task
        self._metrics.scheduled_count += 1
        self._metrics.active_count += 1
        task.add_done_callback(self._complete)
        self._record_pending_highwater()

    def take_completed(self) -> PartialDecode | None:
        self.harvest()
        if self._error is not None:
            error = self._error
            self._error = None
            raise error
        result = self._completed
        self._completed = None
        return result

    async def wait_for_completed(self) -> PartialDecode | None:
        task = self._task
        if task is not None:
            try:
                await asyncio.shield(task)
            except BaseException:
                pass
        return self.take_completed()

    def harvest(self) -> None:
        if self._task is not None and self._task.done():
            self._complete(self._task)

    def invalidate(self) -> None:
        self.harvest()
        self._invalidated = True
        if self._completed is not None or self._error is not None:
            self._metrics.invalidated_count += 1
            self._completed = None
            self._error = None
        self._pending.clear()

    @property
    def result_ready(self) -> bool:
        return self._completed is not None or self._error is not None

    @property
    def pending_audio_ms(self) -> float:
        return len(self._pending) / 2 / self._sample_rate * 1000

    def _complete(self, task: asyncio.Task[PartialDecode]) -> None:
        if self._task is not task:
            return
        self._task = None
        self._metrics.completed_count += 1
        self._metrics.active_count = max(0, self._metrics.active_count - 1)
        try:
            result = task.result()
        except BaseException as exc:
            if self._invalidated:
                self._metrics.invalidated_count += 1
            else:
                self._error = exc
            return
        self._metrics.total_latency_ms += result.latency_ms
        self._metrics.timed_count += 1
        self._metrics.max_latency_ms = max(
            self._metrics.max_latency_ms,
            result.latency_ms,
        )
        if self._invalidated:
            self._metrics.invalidated_count += 1
        else:
            self._completed = result

    def _record_pending_highwater(self) -> None:
        self._metrics.max_pending_audio_ms = max(
            self._metrics.max_pending_audio_ms,
            self.pending_audio_ms,
        )


def _push_audio(
    push: Callable[..., tuple[int, str, str]],
    model_state: object,
    pcm: bytes,
    sample_rate: int,
    end_timestamp_ms: int,
) -> PartialDecode:
    started = monotonic()
    decode_id, text, model_language = push(
        model_state,
        pcm16_to_float_16k(pcm, sample_rate),
    )
    return PartialDecode(
        decode_id=decode_id,
        text=text,
        model_language=model_language,
        end_timestamp_ms=end_timestamp_ms,
        latency_ms=round((monotonic() - started) * 1000, 3),
    )


def pcm16_to_float_16k(pcm: bytes, sample_rate: int) -> np.ndarray:
    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
    if sample_rate == 16000:
        return samples
    if sample_rate != 24000:
        raise ValueError(f"unsupported streaming sample rate: {sample_rate}")
    from scipy.signal import resample_poly

    return resample_poly(samples, 2, 3).astype(np.float32, copy=False)
