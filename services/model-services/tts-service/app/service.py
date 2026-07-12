import base64
import binascii
from pathlib import Path
import re

from app.model_loader import TtsEngine
from app.errors import TtsUnavailableError
from app.schemas import (
    TtsSynthesizeRequest,
    TtsSynthesizeResponse,
    VoiceReferenceUploadResponse,
)


VOICE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
MAX_REFERENCE_AUDIO_BYTES = 10 * 1024 * 1024


class TtsService:
    def __init__(self, engine: TtsEngine, voice_reference_dir: str = "") -> None:
        self.engine = engine
        self.voice_reference_dir = Path(voice_reference_dir) if voice_reference_dir else None

    def health(self) -> tuple[bool, str | None]:
        return self.engine.health()

    def sample_rates(self) -> tuple[int | None, int]:
        return self.engine.sample_rates()

    async def synthesize(
        self,
        request: TtsSynthesizeRequest,
    ) -> TtsSynthesizeResponse:
        return await self.engine.synthesize(request)

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
