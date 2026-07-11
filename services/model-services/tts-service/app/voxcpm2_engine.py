from pathlib import Path
from inspect import signature
import time

from app.audio import flatten_numeric_audio, pcm16_base64_from_floats
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


class VoxCpm2TtsEngine:
    def __init__(
        self,
        *,
        model_dir: str,
        cfg_value: float,
        inference_timesteps: int,
        load_denoiser: bool,
        voice_reference_dir: str = "",
    ) -> None:
        self.model_dir = Path(model_dir)
        self.cfg_value = cfg_value
        self.inference_timesteps = inference_timesteps
        self.load_denoiser = load_denoiser
        self.voice_reference_dir = Path(voice_reference_dir) if voice_reference_dir else None
        self._model = None
        self._load_error: str | None = None

    def health(self) -> tuple[bool, str | None]:
        if self._model is not None:
            return True, None
        return self._can_load()

    async def synthesize(
        self,
        request: TtsSynthesizeRequest,
    ) -> TtsSynthesizeResponse:
        model = self._load()
        sample_rate = parse_sample_rate(getattr(getattr(model, "tts_model", None), "sample_rate", 24000))
        text = build_voxcpm2_text(request.text, request.language)
        reference_wav_path = self._reference_wav_path(request)
        started = time.perf_counter()
        audio, first_audio_ms = self._generate(model, text, request, reference_wav_path, started)
        if not audio:
            raise TtsUnavailableError("VoxCPM2 returned empty audio")
        audio_duration_ms = max(1, round(len(audio) / sample_rate * 1000))
        return TtsSynthesizeResponse(
            provider="voxcpm2",
            model="VoxCPM2",
            voiceMode=request.voice.mode if request.voice else "preset",
            voiceProfileId=request.voice.voiceProfileId if request.voice else None,
            firstAudioMs=first_audio_ms,
            audioDurationMs=audio_duration_ms,
            audio=TtsAudioPayload(
                sampleRate=sample_rate,
                data=pcm16_base64_from_floats(audio),
            ),
        )

    def _generate(
        self,
        model,
        text: str,
        request: TtsSynthesizeRequest,
        reference_wav_path: Path | None,
        started: float,
    ) -> tuple[list[float], int]:
        kwargs = voxcpm2_generate_kwargs(
            model.generate_streaming if hasattr(model, "generate_streaming") else model.generate,
            text=text,
            request=request,
            reference_wav_path=reference_wav_path,
            cfg_value=self.cfg_value,
            inference_timesteps=self.inference_timesteps,
        )
        if hasattr(model, "generate_streaming"):
            chunks = []
            first_audio_ms = None
            for chunk in model.generate_streaming(**kwargs):
                if first_audio_ms is None:
                    first_audio_ms = elapsed_ms(started)
                chunks.extend(flatten_numeric_audio(chunk))
            return chunks, first_audio_ms or elapsed_ms(started)
        audio = model.generate(**kwargs)
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
            import voxcpm  # noqa: F401
        except Exception as exc:
            return False, f"VoxCPM2 runtime is not installed: {exc}"
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


def build_voxcpm2_text(text: str, language: str) -> str:
    if language == "zh":
        return "(A clear, warm Mandarin voice for phone translation)" + text
    return "(A clear, warm English voice for phone translation)" + text


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
            **{key: value for key, value in optional_kwargs.items() if value},
        },
    )


def clone_voice_kwargs(voice, reference_wav_path: Path | None) -> dict:
    if not voice or not reference_wav_path:
        return {}
    if voice.mode == "ultimate_clone" and voice.referenceTranscript:
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


def parse_sample_rate(value) -> int:
    return 16000 if int(value) == 16000 else 24000


def elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)
