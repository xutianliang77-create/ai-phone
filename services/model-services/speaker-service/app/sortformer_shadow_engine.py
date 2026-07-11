import asyncio
import base64
from dataclasses import dataclass, field
import os
import tempfile
import wave

from app.schemas import CreateSpeakerSessionRequest, SpeakerAudioFrame, SpeakerSpan


@dataclass
class _Session:
    sample_rate: int | None = None
    pcm: bytearray = field(default_factory=bytearray)
    first_timestamp_ms: int | None = None
    inferred_duration_ms: int = 0
    last_inference_duration_ms: int = 0
    emitted: set[tuple[str, int, int]] = field(default_factory=set)


class SortformerShadowEngine:
    def __init__(
        self,
        model_id: str,
        inference_interval_ms: int,
        stabilization_ms: int,
        max_context_ms: int,
    ) -> None:
        from nemo.collections.asr.models import SortformerEncLabelModel

        self._model = SortformerEncLabelModel.from_pretrained(model_id)
        self._model.eval()
        modules = self._model.sortformer_modules
        modules.chunk_len = 340
        modules.chunk_right_context = 40
        modules.fifo_len = 40
        modules.spkcache_update_period = 300
        modules._check_streaming_parameters()
        self._interval_ms = inference_interval_ms
        self._stabilization_ms = stabilization_ms
        self._max_context_ms = max_context_ms
        self._sessions: dict[str, _Session] = {}

    async def create_session(self, request: CreateSpeakerSessionRequest) -> None:
        self._sessions[request.sessionId] = _Session()

    async def push_audio(self, frame: SpeakerAudioFrame) -> list[SpeakerSpan]:
        session = self._session(frame.sessionId)
        self._append(session, frame)
        if session.inferred_duration_ms - session.last_inference_duration_ms < self._interval_ms:
            return []
        session.last_inference_duration_ms = session.inferred_duration_ms
        return await asyncio.to_thread(self._infer, session, False)

    async def flush(self, session_id: str) -> list[SpeakerSpan]:
        return await asyncio.to_thread(self._infer, self._session(session_id), True)

    async def close_session(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def _append(self, session: _Session, frame: SpeakerAudioFrame) -> None:
        if session.sample_rate not in (None, frame.sampleRate):
            raise ValueError("sample rate changed during speaker session")
        session.sample_rate = frame.sampleRate
        if session.first_timestamp_ms is None:
            session.first_timestamp_ms = frame.timestampMs
        chunk = base64.b64decode(frame.data, validate=True)
        session.pcm.extend(chunk)
        session.inferred_duration_ms += len(chunk) * 1000 // (frame.sampleRate * 2)
        if session.inferred_duration_ms > self._max_context_ms:
            raise RuntimeError("sortformer shadow context exceeded")

    def _infer(self, session: _Session, flush: bool) -> list[SpeakerSpan]:
        if not session.pcm or not session.sample_rate or session.first_timestamp_ms is None:
            return []
        path = write_temp_wav(bytes(session.pcm), session.sample_rate)
        try:
            predicted = self._model.diarize(audio=[path], batch_size=1)[0]
        finally:
            os.unlink(path)
        stable_end = session.inferred_duration_ms if flush else (
            session.inferred_duration_ms - self._stabilization_ms
        )
        result: list[SpeakerSpan] = []
        for item in predicted:
            span = parse_segment(item, session.first_timestamp_ms)
            relative_end = span.endMs - session.first_timestamp_ms
            key = (span.speakerId, span.startMs, span.endMs)
            if relative_end > stable_end or key in session.emitted:
                continue
            session.emitted.add(key)
            result.append(span)
        return result

    def _session(self, session_id: str) -> _Session:
        session = self._sessions.get(session_id)
        if session is None:
            raise KeyError("speaker session not found")
        return session


def parse_segment(value: object, offset_ms: int) -> SpeakerSpan:
    fields = value.replace(",", " ").split() if isinstance(value, str) else list(value)
    if len(fields) < 3:
        raise ValueError(f"Unsupported Sortformer segment: {value!r}")
    start_ms = offset_ms + round(float(fields[0]) * 1000)
    end_ms = offset_ms + round(float(fields[1]) * 1000)
    label = str(fields[2])
    digits = "".join(character for character in label if character.isdigit())
    speaker_id = f"speaker_{int(digits) + 1}" if digits else label
    return SpeakerSpan(speakerId=speaker_id, startMs=start_ms, endMs=end_ms)


def write_temp_wav(pcm: bytes, sample_rate: int) -> str:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as output:
        path = output.name
    with wave.open(path, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        audio.writeframes(pcm)
    return path
