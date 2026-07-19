import base64
import binascii
import asyncio
from collections.abc import Callable
import time
from pathlib import Path
import re

from app.model_loader import TtsEngine
from app.errors import TtsUnavailableError
from app.schemas import (
    TtsSynthesizeRequest,
    TtsSynthesizeResponse,
    VoiceReferenceUploadResponse,
    VoicePresetCatalogResponse,
)
from app.voice_preset_catalog import VoicePresetCatalog


VOICE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
MAX_REFERENCE_AUDIO_BYTES = 10 * 1024 * 1024


class TtsService:
    def __init__(
        self,
        engine: TtsEngine,
        voice_reference_dir: str = "",
        voice_presets: VoicePresetCatalog | None = None,
        fatal_runtime_handler: Callable[[], None] | None = None,
    ) -> None:
        self.engine = engine
        self.voice_reference_dir = Path(voice_reference_dir) if voice_reference_dir else None
        self.voice_presets = voice_presets or VoicePresetCatalog()
        self._warmup_lock = asyncio.Lock()
        self._warmup_result: dict[str, object] | None = None
        self._fatal_runtime_handler = fatal_runtime_handler or (lambda: None)
        self._fatal_runtime_handler_called = False
        self._runtime_failure_reason: str | None = None
        self._inference_ready = False

    def health(self) -> tuple[bool, str | None]:
        if self._runtime_failure_reason:
            return False, self._runtime_failure_reason
        return self.engine.health()

    def readiness(self) -> tuple[bool, str | None]:
        available, reason = self.health()
        if not available:
            return False, reason
        if not self._inference_ready:
            return False, "tts inference readiness has not been established"
        return True, None

    def sample_rates(self) -> tuple[int | None, int]:
        return self.engine.sample_rates()

    async def synthesize(
        self,
        request: TtsSynthesizeRequest,
    ) -> TtsSynthesizeResponse:
        self._require_available()
        try:
            speech = await self.engine.synthesize(self.voice_presets.resolve_request(request))
        except Exception as exc:
            self._handle_runtime_error(exc)
            raise
        self._inference_ready = True
        return speech

    async def synthesize_stream(self, request: TtsSynthesizeRequest):
        self._require_available()
        resolved = self.voice_presets.resolve_request(request)
        stream = getattr(self.engine, "synthesize_stream", None)
        try:
            if callable(stream):
                async for event in stream(resolved):
                    if event.get("type") == "audio_chunk" and event.get("data"):
                        self._inference_ready = True
                    yield event
                return
            speech = await self.synthesize(request)
            body = speech.model_dump(exclude={"audio"}, exclude_none=True)
            yield {"type": "metadata", **body}
            pcm = base64.b64decode(speech.audio.data)
            bytes_per_chunk = max(2, int(speech.audio.sampleRate * 2 * 0.1))
            for offset in range(0, len(pcm), bytes_per_chunk):
                chunk = pcm[offset:offset + bytes_per_chunk]
                yield {
                    "type": "audio_chunk",
                    "format": "pcm16",
                    "sampleRate": speech.audio.sampleRate,
                    "sequence": offset // bytes_per_chunk + 1,
                    "data": base64.b64encode(chunk).decode("ascii"),
                }
            yield {"type": "final", "audioDurationMs": speech.audioDurationMs}
        except Exception as exc:
            self._handle_runtime_error(exc)
            raise

    async def warmup(self, request: TtsSynthesizeRequest) -> dict[str, object]:
        if self._warmup_result is not None:
            return {**self._warmup_result, "cached": True}
        async with self._warmup_lock:
            if self._warmup_result is not None:
                return {**self._warmup_result, "cached": True}
            started = time.perf_counter()
            speech = await self.synthesize(request)
            self._warmup_result = {
                "status": "ok",
                "cached": False,
                "elapsedMs": round((time.perf_counter() - started) * 1000),
                "firstAudioMs": speech.firstAudioMs,
                "provider": speech.provider,
                "model": speech.model,
            }
            return self._warmup_result

    def _require_available(self) -> None:
        available, reason = self.health()
        if not available:
            raise TtsUnavailableError(reason or "TTS runtime is unavailable")

    def _handle_runtime_error(self, error: Exception) -> None:
        if isinstance(error, TtsUnavailableError) or not is_fatal_runtime_error(error):
            return
        self._runtime_failure_reason = fatal_runtime_reason(error)
        self._inference_ready = False
        self._warmup_result = None
        if self._fatal_runtime_handler_called:
            return
        self._fatal_runtime_handler_called = True
        self._fatal_runtime_handler()

    def preset_catalog(self) -> VoicePresetCatalogResponse:
        return self.voice_presets.response()

    def save_voice_reference_audio(
        self,
        reference_audio_id: str,
        audio_base64: str,
    ) -> VoiceReferenceUploadResponse:
        if not VOICE_ID_PATTERN.fullmatch(reference_audio_id):
            raise ValueError("invalid reference audio id")
        if not self.voice_reference_dir:
            raise TtsUnavailableError("Voice reference directory is not configured")
        try:
            audio = base64.b64decode(audio_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("invalid reference audio") from exc
        if not audio or len(audio) > MAX_REFERENCE_AUDIO_BYTES:
            raise ValueError("invalid reference audio size")
        if not is_wav(audio):
            raise ValueError("invalid reference audio format")

        self.voice_reference_dir.mkdir(parents=True, exist_ok=True)
        path = self.voice_reference_dir / f"{reference_audio_id}.wav"
        path.write_bytes(audio)
        return VoiceReferenceUploadResponse(
            referenceAudioId=reference_audio_id,
            bytes=len(audio),
        )


def is_wav(audio: bytes) -> bool:
    return len(audio) > 12 and audio[:4] == b"RIFF" and audio[8:12] == b"WAVE"


def is_fatal_runtime_error(error: BaseException) -> bool:
    current: BaseException | None = error
    messages: list[str] = []
    for _ in range(4):
        if current is None:
            break
        messages.append(f"{type(current).__name__}: {current}".lower())
        current = current.__cause__ or current.__context__
    combined = " ".join(messages)
    return any(marker in combined for marker in (
        "device-side assert",
        "acceleratorerror",
        "cuda error",
        "cuda out of memory",
        "cublas",
        "cudnn",
    ))


def fatal_runtime_reason(error: BaseException) -> str:
    message = f"{type(error).__name__}: {error}".lower()
    if "device-side assert" in message:
        return "tts CUDA device-side assert; process restart required"
    if "out of memory" in message:
        return "tts CUDA out of memory; process restart required"
    return "tts CUDA runtime failed; process restart required"
