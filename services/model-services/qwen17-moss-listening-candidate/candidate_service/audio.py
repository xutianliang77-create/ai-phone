from __future__ import annotations

import base64
import tempfile
import unicodedata
import wave
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly


IGNORED_FILLERS = frozenset({"啊", "呃", "嗯", "哦"})
LANGUAGE_CODES = {
    "arabic": "ar",
    "chinese": "zh",
    "english": "en",
    "french": "fr",
    "german": "de",
    "hindi": "hi",
    "japanese": "ja",
    "korean": "ko",
    "portuguese": "pt",
    "russian": "ru",
    "spanish": "es",
    "vietnamese": "vi",
}


def decode_request_audio(
    request: dict[str, object],
) -> tuple[np.ndarray, int]:
    if request.get("format") != "pcm16":
        raise ValueError("only pcm16 audio is supported")
    sample_rate = int(request["sampleRate"])
    if sample_rate not in {16000, 24000}:
        raise ValueError("sampleRate must be 16000 or 24000")
    raw = base64.b64decode(str(request["data"]), validate=True)
    if len(raw) % 2:
        raise ValueError("pcm16 payload has an odd byte length")
    return np.frombuffer(raw, dtype="<i2").copy(), sample_rate


def to_16khz_float(pcm: np.ndarray, sample_rate: int) -> np.ndarray:
    audio = pcm.astype(np.float32) / 32768
    if sample_rate == 16000:
        return audio
    return resample_poly(audio, 2, 3).astype(np.float32, copy=False)


def normalized_content(text: str) -> str:
    return "".join(
        character
        for character in str(text or "")
        if unicodedata.category(character)[:1] in {"L", "N"}
        and character not in IGNORED_FILLERS
    )


def confirmed_readable_prefix(
    previous: str,
    current: str,
    minimum_units: int,
) -> str | None:
    if not previous or not current:
        return None
    limit = min(len(previous), len(current))
    index = 0
    while index < limit and previous[index] == current[index]:
        index += 1
    prefix = current[:index].rstrip()
    return prefix if len(normalized_content(prefix)) >= minimum_units else None


def language_code(model_language: str, requested: str) -> str:
    mapped = LANGUAGE_CODES.get(model_language.strip().casefold())
    if mapped:
        return mapped
    normalized = requested.strip().lower().replace("_", "-")
    if normalized != "auto":
        return normalized.split("-", 1)[0]
    return "en"


def write_temp_wav(audio: np.ndarray) -> str:
    handle = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    handle.close()
    data = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
    with wave.open(handle.name, "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(16000)
        stream.writeframes(data)
    return handle.name


def remove_temp_wav(path: str) -> None:
    Path(path).unlink(missing_ok=True)
