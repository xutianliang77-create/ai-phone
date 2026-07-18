import asyncio
import base64
import math
import time
from array import array
from collections.abc import AsyncIterator

from app.audio import flatten_numeric_audio, resample_audio
from app.errors import TtsUnavailableError


OUTPUT_SAMPLE_RATE = 24000


async def stream_voxcpm2(
    *,
    model,
    kwargs: dict,
    model_sample_rate: int,
) -> AsyncIterator[dict[str, object]]:
    generate_streaming = getattr(model, "generate_streaming", None)
    if not callable(generate_streaming):
        raise TtsUnavailableError("VoxCPM2 runtime does not support generate_streaming")
    iterator = iter(generate_streaming(**kwargs))
    started = time.perf_counter()
    normalizer = StreamingLoudnessNormalizer()
    sequence = 0
    output_samples = 0
    metadata_sent = False
    try:
        while True:
            item = await next_in_thread(iterator)
            if item is STREAM_DONE:
                break
            samples = flatten_numeric_audio(item)
            if not samples:
                continue
            try:
                output = resample_audio(
                    samples,
                    source_rate=model_sample_rate,
                    target_rate=OUTPUT_SAMPLE_RATE,
                )
                output = normalizer.apply(output)
            except (RuntimeError, ValueError) as exc:
                raise TtsUnavailableError(
                    f"VoxCPM2 streaming resampling failed: {exc}",
                ) from exc
            if not output:
                continue
            if not metadata_sent:
                metadata_sent = True
                yield {
                    "type": "metadata",
                    "provider": "voxcpm2",
                    "model": "VoxCPM2",
                    "firstAudioMs": elapsed_ms(started),
                    "modelSampleRate": model_sample_rate,
                    "outputSampleRate": OUTPUT_SAMPLE_RATE,
                }
            sequence += 1
            output_samples += len(output)
            yield {
                "type": "audio_chunk",
                "format": "pcm16",
                "sampleRate": OUTPUT_SAMPLE_RATE,
                "sequence": sequence,
                "data": pcm16_base64(output),
            }
        if not metadata_sent or output_samples == 0:
            raise TtsUnavailableError("VoxCPM2 streaming returned empty audio")
        yield {
            "type": "final",
            "audioDurationMs": max(
                1,
                round(output_samples / OUTPUT_SAMPLE_RATE * 1000),
            ),
        }
    finally:
        close_iterator(iterator)


class StreamingLoudnessNormalizer:
    def __init__(
        self,
        target_rms: float = 0.126,
        max_gain: float = 8.0,
        peak_ceiling: float = 0.95,
    ) -> None:
        self.target_rms = target_rms
        self.max_gain = max_gain
        self.peak_ceiling = peak_ceiling
        self.gain: float | None = None

    def apply(self, samples: list[float]) -> list[float]:
        if not samples:
            return samples
        if self.gain is None:
            rms = math.sqrt(sum(value * value for value in samples) / len(samples))
            peak = max(abs(value) for value in samples)
            if rms > 1e-8 and peak > 1e-8:
                self.gain = min(
                    self.max_gain,
                    self.target_rms / rms if rms < self.target_rms else 1.0,
                    self.peak_ceiling / peak,
                )
        gain = self.gain if self.gain is not None else 1.0
        return [
            max(-self.peak_ceiling, min(self.peak_ceiling, value * gain))
            for value in samples
        ]


class _StreamDone:
    pass


STREAM_DONE = _StreamDone()


def next_or_done(iterator):
    try:
        return next(iterator)
    except StopIteration:
        return STREAM_DONE


async def next_in_thread(iterator):
    pending = asyncio.create_task(asyncio.to_thread(next_or_done, iterator))
    try:
        return await asyncio.shield(pending)
    except asyncio.CancelledError:
        pending.add_done_callback(lambda _future: close_iterator(iterator))
        raise


def close_iterator(iterator) -> None:
    close = getattr(iterator, "close", None)
    if not callable(close):
        return
    try:
        close()
    except (RuntimeError, ValueError):
        pass


def pcm16_base64(samples: list[float]) -> str:
    pcm = array("h")
    for value in samples:
        pcm.append(int(max(-1.0, min(1.0, float(value))) * 32767))
    return base64.b64encode(pcm.tobytes()).decode("ascii")


def elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)
