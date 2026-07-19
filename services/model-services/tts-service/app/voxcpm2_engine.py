import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from inspect import signature
import json
import logging
import time

from app.audio import (
    flatten_numeric_audio,
    normalize_audio_loudness,
    pcm16_base64_from_floats,
    resample_audio,
)
from app.errors import TtsUnavailableError
from app.schemas import TtsAudioPayload, TtsSynthesizeRequest, TtsSynthesizeResponse


VOXCPM2_GENERATE_KWARGS = frozenset({
    "text",
    "prompt_wav_path",
    "prompt_text",
    "reference_wav_path",
    "cfg_value",
    "inference_timesteps",
    "min_len",
    "max_len",
    "normalize",
    "denoise",
    "retry_badcase",
    "retry_badcase_max_times",
    "retry_badcase_ratio_threshold",
    "streaming",
})
OUTPUT_SAMPLE_RATE = 24000
logger = logging.getLogger("uvicorn.error")


class VoxCpm2TtsEngine:
    def __init__(
        self,
        *,
        model_dir: str,
        cfg_value: float,
        inference_timesteps: int,
        hifi_inference_timesteps: int = 15,
        inference_wait_ms: int = 15000,
        load_denoiser: bool,
        require_streaming: bool = False,
        voice_reference_dir: str = "",
    ) -> None:
        self.model_dir = Path(model_dir)
        self.cfg_value = cfg_value
        self.inference_timesteps = inference_timesteps
        self.hifi_inference_timesteps = hifi_inference_timesteps
        if inference_wait_ms < 1:
            raise ValueError("VoxCPM2 inference wait must be positive")
        self.inference_wait_ms = inference_wait_ms
        self._inference_lock = asyncio.Lock()
        self.load_denoiser = load_denoiser
        self.require_streaming = require_streaming
        self.voice_reference_dir = Path(voice_reference_dir) if voice_reference_dir else None
        self._model = None
        self._load_error: str | None = None
        self._model_sample_rate = configured_model_sample_rate(self.model_dir)

    def health(self) -> tuple[bool, str | None]:
        if self._model is not None:
            return True, None
        return self._can_load()

    def sample_rates(self) -> tuple[int | None, int]:
        return self._model_sample_rate, OUTPUT_SAMPLE_RATE

    async def synthesize(
        self,
        request: TtsSynthesizeRequest,
    ) -> TtsSynthesizeResponse:
        async with self._inference_slot():
            model = self._load()
            model_sample_rate = parse_model_sample_rate(
                getattr(getattr(model, "tts_model", None), "sample_rate", None)
                or self._model_sample_rate
                or OUTPUT_SAMPLE_RATE
            )
            self._model_sample_rate = model_sample_rate
            text = build_voxcpm2_text(request.text, request.language)
            reference_wav_path = self._reference_wav_path(request)
            started = time.perf_counter()
            audio, first_audio_ms = self._generate(
                model,
                text,
                request,
                reference_wav_path,
                started,
            )
            if not audio:
                raise TtsUnavailableError("VoxCPM2 returned empty audio")
            try:
                output_audio = resample_audio(
                    audio,
                    source_rate=model_sample_rate,
                    target_rate=OUTPUT_SAMPLE_RATE,
                )
                output_audio = normalize_audio_loudness(output_audio)
            except (RuntimeError, ValueError) as exc:
                raise TtsUnavailableError(f"VoxCPM2 resampling failed: {exc}") from exc
            audio_duration_ms = max(
                1,
                round(len(output_audio) / OUTPUT_SAMPLE_RATE * 1000),
            )
            logger.info(
                "VoxCPM2 synthesis completed segmentId=%s voiceMode=%s "
                "textCharacters=%d generationMs=%d audioDurationMs=%d "
                "modelSampleRate=%d outputSampleRate=%d",
                request.segmentId,
                request.voice.mode if request.voice else "preset",
                len(text),
                elapsed_ms(started),
                audio_duration_ms,
                model_sample_rate,
                OUTPUT_SAMPLE_RATE,
            )
            return TtsSynthesizeResponse(
                provider="voxcpm2",
                model="VoxCPM2",
                voiceMode=request.voice.mode if request.voice else "preset",
                voiceProfileId=request.voice.voiceProfileId if request.voice else None,
                presetId=request.voice.presetId if request.voice else None,
                firstAudioMs=first_audio_ms,
                audioDurationMs=audio_duration_ms,
                modelSampleRate=model_sample_rate,
                outputSampleRate=OUTPUT_SAMPLE_RATE,
                audio=TtsAudioPayload(
                    sampleRate=OUTPUT_SAMPLE_RATE,
                    data=pcm16_base64_from_floats(output_audio),
                ),
            )

    async def synthesize_stream(self, request: TtsSynthesizeRequest):
        from app.voxcpm2_streaming import stream_voxcpm2

        async with self._inference_slot():
            model = self._load()
            model_sample_rate = parse_model_sample_rate(
                getattr(getattr(model, "tts_model", None), "sample_rate", None)
                or self._model_sample_rate
                or OUTPUT_SAMPLE_RATE
            )
            self._model_sample_rate = model_sample_rate
            generate_streaming = getattr(model, "generate_streaming", None)
            if not callable(generate_streaming):
                raise TtsUnavailableError(
                    "VoxCPM2 runtime does not support generate_streaming",
                )
            text = build_voxcpm2_text(request.text, request.language)
            kwargs = voxcpm2_generate_kwargs(
                generate_streaming,
                text=text,
                request=request,
                reference_wav_path=self._reference_wav_path(request),
                cfg_value=self.cfg_value,
                inference_timesteps=(
                    self.hifi_inference_timesteps
                    if request.voice and request.voice.quality == "hifi"
                    else self.inference_timesteps
                ),
            )
            async for event in stream_voxcpm2(
                model=model,
                kwargs=kwargs,
                model_sample_rate=model_sample_rate,
            ):
                if event["type"] == "metadata":
                    event.update({
                        "voiceMode": request.voice.mode if request.voice else "preset",
                        "voiceProfileId": (
                            request.voice.voiceProfileId if request.voice else None
                        ),
                        "presetId": request.voice.presetId if request.voice else None,
                    })
                yield event

    @asynccontextmanager
    async def _inference_slot(self):
        try:
            async with asyncio.timeout(self.inference_wait_ms / 1000):
                await self._inference_lock.acquire()
        except TimeoutError as exc:
            raise TtsUnavailableError(
                f"VoxCPM2 inference remained busy for {self.inference_wait_ms}ms",
            ) from exc
        try:
            yield
        finally:
            self._inference_lock.release()

    def _generate(
        self,
        model,
        text: str,
        request: TtsSynthesizeRequest,
        reference_wav_path: Path | None,
        started: float,
    ) -> tuple[list[float], int]:
        generate = model.generate
        kwargs = voxcpm2_generate_kwargs(
            generate,
            text=text,
            request=request,
            reference_wav_path=reference_wav_path,
            cfg_value=self.cfg_value,
            inference_timesteps=(
                self.hifi_inference_timesteps
                if request.voice and request.voice.quality == "hifi"
                else self.inference_timesteps
            ),
        )
        audio = generate(**kwargs)
        return flatten_numeric_audio(audio), elapsed_ms(started)

    def _reference_wav_path(self, request: TtsSynthesizeRequest) -> Path | None:
        reference_audio_id = request.voice.referenceAudioId if request.voice else None
        if not reference_audio_id:
            return None
        if not self.voice_reference_dir:
            raise TtsUnavailableError("Voice reference directory is not configured")
        candidate = self.voice_reference_dir / f"{reference_audio_id}.wav"
        if not candidate.exists() or not candidate.is_file():
            raise TtsUnavailableError(f"Voice reference audio does not exist: {reference_audio_id}")
        return candidate

    def _can_load(self) -> tuple[bool, str | None]:
        if self._load_error:
            return False, self._load_error
        if not self.model_dir.exists():
            return False, f"VoxCPM2 model dir does not exist: {self.model_dir}"
        try:
            from voxcpm import VoxCPM
        except Exception as exc:
            return False, f"VoxCPM2 runtime is not installed: {exc}"
        if self.require_streaming and not callable(
            getattr(VoxCPM, "generate_streaming", None),
        ):
            return False, "VoxCPM2 runtime does not support generate_streaming"
        return True, None

    def _load(self):
        if self._model is not None:
            return self._model
        available, reason = self._can_load()
        if not available:
            raise TtsUnavailableError(reason or "VoxCPM2 is unavailable")
        try:
            from voxcpm import VoxCPM

            self._model = VoxCPM.from_pretrained(
                str(self.model_dir),
                load_denoiser=self.load_denoiser,
            )
            return self._model
        except Exception as exc:
            self._load_error = f"VoxCPM2 load failed: {exc}"
            raise TtsUnavailableError(self._load_error) from exc


def build_voxcpm2_text(text: str, _language: str) -> str:
    return text.strip()


def voxcpm2_generate_kwargs(
    generate_fn,
    *,
    text: str,
    request: TtsSynthesizeRequest,
    reference_wav_path: Path | None,
    cfg_value: float,
    inference_timesteps: int,
) -> dict:
    voice = request.voice
    optional_kwargs = clone_voice_kwargs(voice, reference_wav_path)
    return supported_kwargs(
        generate_fn,
        {
            "text": text,
            "cfg_value": cfg_value,
            "inference_timesteps": inference_timesteps,
            "retry_badcase": True,
            "retry_badcase_max_times": 3,
            "retry_badcase_ratio_threshold": 6.0,
            **{key: value for key, value in optional_kwargs.items() if value},
        },
    )


def clone_voice_kwargs(voice, reference_wav_path: Path | None) -> dict:
    if not voice or not reference_wav_path:
        return {}
    if voice.mode in {"ultimate_clone", "preset"} and voice.referenceTranscript:
        return {
            "prompt_wav_path": str(reference_wav_path),
            "prompt_text": voice.referenceTranscript,
            "reference_wav_path": str(reference_wav_path),
        }
    return {"reference_wav_path": str(reference_wav_path)}


def supported_kwargs(fn, values: dict) -> dict:
    try:
        parameters = signature(fn).parameters
    except (TypeError, ValueError):
        return {key: value for key, value in values.items() if key in VOXCPM2_GENERATE_KWARGS}
    if any(parameter.kind == parameter.VAR_KEYWORD for parameter in parameters.values()):
        return {key: value for key, value in values.items() if key in VOXCPM2_GENERATE_KWARGS}
    return {key: value for key, value in values.items() if key in parameters}


def parse_model_sample_rate(value) -> int:
    try:
        sample_rate = int(value)
    except (TypeError, ValueError) as exc:
        raise TtsUnavailableError(f"Invalid VoxCPM2 sample rate: {value}") from exc
    if sample_rate < 8000 or sample_rate > 192000:
        raise TtsUnavailableError(f"Invalid VoxCPM2 sample rate: {sample_rate}")
    return sample_rate


def configured_model_sample_rate(model_dir: Path) -> int | None:
    try:
        config = json.loads((model_dir / "config.json").read_text(encoding="utf-8"))
        audio_config = config.get("audio_vae_config", {})
        value = audio_config.get("out_sample_rate") or audio_config.get("sample_rate")
        return parse_model_sample_rate(value) if value else None
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None


def elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)
