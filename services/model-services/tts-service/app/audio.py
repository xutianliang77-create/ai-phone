import base64
import math
from array import array
from collections.abc import Iterable


def pcm16_base64_from_floats(samples: Iterable[float]) -> str:
    pcm = array("h")
    for value in samples:
        sample = max(-1.0, min(1.0, float(value)))
        pcm.append(int(sample * 32767))
    return base64.b64encode(pcm.tobytes()).decode("ascii")


def sine_pcm16_base64(
    *,
    sample_rate: int,
    duration_ms: int,
    frequency_hz: int = 440,
) -> str:
    sample_count = max(1, round(sample_rate * duration_ms / 1000))
    amplitude = 0.18
    samples = (
        amplitude * math.sin(2 * math.pi * frequency_hz * index / sample_rate)
        for index in range(sample_count)
    )
    return pcm16_base64_from_floats(samples)


def flatten_numeric_audio(audio) -> list[float]:
    if hasattr(audio, "detach"):
        audio = audio.detach().cpu().numpy()
    if hasattr(audio, "reshape") and hasattr(audio, "tolist"):
        return [float(value) for value in audio.reshape(-1).tolist()]
    if isinstance(audio, (list, tuple)):
        values: list[float] = []
        for item in audio:
            if isinstance(item, (list, tuple)):
                values.extend(flatten_numeric_audio(item))
            else:
                values.append(float(item))
        return values
    return [float(audio)]


def resample_audio(
    samples: Iterable[float],
    *,
    source_rate: int,
    target_rate: int,
) -> list[float]:
    values = [float(value) for value in samples]
    if source_rate <= 0 or target_rate <= 0:
        raise ValueError("sample rates must be positive")
    if not values or source_rate == target_rate:
        return values

    try:
        import numpy as np
        from scipy.signal import resample_poly
    except ImportError as exc:
        raise RuntimeError("VoxCPM2 resampling requires numpy and scipy") from exc

    divisor = math.gcd(source_rate, target_rate)
    result = resample_poly(
        np.asarray(values, dtype=np.float32),
        target_rate // divisor,
        source_rate // divisor,
        window=("kaiser", 5.0),
    )
    expected_count = round(len(values) * target_rate / source_rate)
    if len(result) > expected_count:
        result = result[:expected_count]
    elif len(result) < expected_count:
        result = np.pad(result, (0, expected_count - len(result)))
    return [float(value) for value in result]
