import asyncio
import base64
from dataclasses import dataclass, field
import os
from pathlib import Path
import tempfile
import wave

from app.schemas import CreateSpeakerSessionRequest, SpeakerAudioFrame, SpeakerSpan


@dataclass
class _Session:
    max_speakers: int = 4
    sample_rate: int | None = None
    pcm: bytearray = field(default_factory=bytearray)
    buffer_start_ms: int | None = None
    buffer_duration_ms: int = 0
    total_audio_ms: int = 0
    last_inference_total_ms: int = 0
    finalized_until_ms: int | None = None
    previous_spans: list[SpeakerSpan] = field(default_factory=list)
    label_mapping: dict[str, str] = field(default_factory=dict)
    next_speaker_index: int = 1


class SortformerShadowEngine:
    def __init__(
        self,
        model_id: str,
        inference_interval_ms: int,
        stabilization_ms: int,
        max_context_ms: int,
        model=None,
    ) -> None:
        if model is None:
            from nemo.collections.asr.models import SortformerEncLabelModel

            model = (
                SortformerEncLabelModel.restore_from(
                    restore_path=model_id,
                    map_location="cuda",
                    strict=False,
                )
                if Path(model_id).is_file()
                else SortformerEncLabelModel.from_pretrained(model_id)
            )
        self._model = model
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
        self._sessions[request.sessionId] = _Session(
            max_speakers=request.options.maxSpeakers,
        )

    async def push_audio(self, frame: SpeakerAudioFrame) -> list[SpeakerSpan]:
        session = self._session(frame.sessionId)
        self._append(session, frame)
        if session.total_audio_ms - session.last_inference_total_ms < self._interval_ms:
            return []
        session.last_inference_total_ms = session.total_audio_ms
        return await asyncio.to_thread(self._infer, session, False)

    async def flush(self, session_id: str) -> list[SpeakerSpan]:
        return await asyncio.to_thread(self._infer, self._session(session_id), True)

    async def close_session(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def _append(self, session: _Session, frame: SpeakerAudioFrame) -> None:
        if session.sample_rate not in (None, frame.sampleRate):
            raise ValueError("sample rate changed during speaker session")
        session.sample_rate = frame.sampleRate
        if session.buffer_start_ms is None:
            session.buffer_start_ms = frame.timestampMs
        chunk = base64.b64decode(frame.data, validate=True)
        chunk_ms = len(chunk) * 1000 // (frame.sampleRate * 2)
        session.pcm.extend(chunk)
        session.buffer_duration_ms += chunk_ms
        session.total_audio_ms += chunk_ms
        trim_rolling_context(session, self._max_context_ms)

    def _infer(self, session: _Session, flush: bool) -> list[SpeakerSpan]:
        if not session.pcm or not session.sample_rate or session.buffer_start_ms is None:
            return []
        path = write_temp_wav(bytes(session.pcm), session.sample_rate)
        try:
            predicted = self._model.diarize(audio=[path], batch_size=1)[0]
        finally:
            os.unlink(path)
        raw_spans = [parse_segment(item, session.buffer_start_ms) for item in predicted]
        mapped, mapping, next_index = stabilize_speaker_labels(
            raw_spans,
            session.previous_spans,
            session.label_mapping,
            session.next_speaker_index,
            session.max_speakers,
        )
        session.previous_spans = mapped
        session.label_mapping = mapping
        session.next_speaker_index = next_index
        stable_end = session.buffer_start_ms + session.buffer_duration_ms
        if not flush:
            stable_end -= self._stabilization_ms
        if not mapped:
            return []
        previous_boundary = session.finalized_until_ms or session.buffer_start_ms
        result = finalize_new_spans(mapped, previous_boundary, stable_end)
        session.finalized_until_ms = max(previous_boundary, stable_end)
        return result

    def _session(self, session_id: str) -> _Session:
        session = self._sessions.get(session_id)
        if session is None:
            raise KeyError("speaker session not found")
        return session


def trim_rolling_context(session: _Session, max_context_ms: int) -> None:
    if not session.sample_rate or session.buffer_duration_ms <= max_context_ms:
        return
    trim_ms = session.buffer_duration_ms - max_context_ms
    bytes_per_ms = session.sample_rate * 2 / 1000
    trim_bytes = int(trim_ms * bytes_per_ms)
    trim_bytes -= trim_bytes % 2
    actual_ms = round(trim_bytes / bytes_per_ms)
    del session.pcm[:trim_bytes]
    session.buffer_duration_ms -= actual_ms
    session.buffer_start_ms = (session.buffer_start_ms or 0) + actual_ms
    session.previous_spans = [
        span for span in session.previous_spans
        if span.endMs > session.buffer_start_ms
    ]


def stabilize_speaker_labels(
    current: list[SpeakerSpan],
    previous: list[SpeakerSpan],
    previous_mapping: dict[str, str],
    next_speaker_index: int,
    max_speakers: int = 4,
) -> tuple[list[SpeakerSpan], dict[str, str], int]:
    local_ids = sorted({span.speakerId for span in current})
    stable_ids = sorted({span.speakerId for span in previous})
    scores = []
    for local_id in local_ids:
        local_spans = [span for span in current if span.speakerId == local_id]
        for stable_id in stable_ids:
            stable_spans = [span for span in previous if span.speakerId == stable_id]
            score = sum(
                overlap_ms(left, right)
                for left in local_spans
                for right in stable_spans
            )
            if score > 0:
                scores.append((score, local_id, stable_id))
    mapping: dict[str, str] = {}
    used_stable: set[str] = set()
    for _, local_id, stable_id in sorted(scores, reverse=True):
        if local_id in mapping or stable_id in used_stable:
            continue
        mapping[local_id] = stable_id
        used_stable.add(stable_id)
    for local_id in local_ids:
        prior = previous_mapping.get(local_id)
        if local_id not in mapping and prior and prior not in used_stable:
            mapping[local_id] = prior
            used_stable.add(prior)
    for local_id in local_ids:
        if local_id in mapping:
            continue
        available = [
            f"speaker_{index}"
            for index in range(1, max_speakers + 1)
            if f"speaker_{index}" not in used_stable
        ]
        if not available:
            continue
        stable_id = available[0]
        next_speaker_index = max(next_speaker_index, int(stable_id.split("_")[-1]) + 1)
        mapping[local_id] = stable_id
        used_stable.add(stable_id)
    mapped = [
        span.model_copy(update={"speakerId": mapping[span.speakerId]})
        for span in current
        if span.speakerId in mapping
    ]
    return mapped, mapping, next_speaker_index


def finalize_new_spans(
    spans: list[SpeakerSpan],
    previous_boundary: int,
    stable_end: int,
) -> list[SpeakerSpan]:
    result = []
    for span in spans:
        if span.endMs <= previous_boundary or span.startMs >= stable_end:
            continue
        start_ms = max(previous_boundary, span.startMs)
        end_ms = min(stable_end, span.endMs)
        if end_ms > start_ms:
            result.append(span.model_copy(update={
                "startMs": start_ms,
                "endMs": end_ms,
            }))
    return result


def overlap_ms(left: SpeakerSpan, right: SpeakerSpan) -> int:
    return max(0, min(left.endMs, right.endMs) - max(left.startMs, right.startMs))


def parse_segment(value: object, offset_ms: int) -> SpeakerSpan:
    fields = value.replace(",", " ").split() if isinstance(value, str) else list(value)
    if len(fields) < 3:
        raise ValueError(f"Unsupported Sortformer segment: {value!r}")
    start_ms = offset_ms + round(float(fields[0]) * 1000)
    end_ms = offset_ms + round(float(fields[1]) * 1000)
    label = str(fields[2])
    digits = "".join(character for character in label if character.isdigit())
    speaker_id = f"local_{int(digits) + 1}" if digits else f"local_{label}"
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
