import base64
from dataclasses import dataclass, field
import struct
from typing import TYPE_CHECKING

from app.schemas import AsrTranscribeRequest

if TYPE_CHECKING:
    from app.vad import VadProvider


class PcmSessionBuffer:
    def __init__(self, min_audio_ms: int) -> None:
        self.min_audio_ms = min_audio_ms
        self._chunks_by_session: dict[str, list[bytes]] = {}
        self._seen_sequences: dict[str, set[int]] = {}

    def append(self, request: AsrTranscribeRequest) -> bytes | None:
        seen = self._seen_sequences.setdefault(request.sessionId, set())
        if request.sequence in seen:
            return None
        seen.add(request.sequence)

        chunk = base64.b64decode(request.data, validate=True)
        chunks = self._chunks_by_session.setdefault(request.sessionId, [])
        chunks.append(chunk)
        if audio_duration_ms(b"".join(chunks), request.sampleRate) < self.min_audio_ms:
            return None

        audio = b"".join(chunks)
        self._chunks_by_session[request.sessionId] = []
        return audio


@dataclass(frozen=True)
class PcmAudioSegment:
    pcm: bytes
    sample_rate: int
    end_sequence: int
    duration_ms: int
    start_timestamp_ms: int
    end_timestamp_ms: int


@dataclass(frozen=True)
class _PcmChunk:
    pcm: bytes
    duration_ms: int
    voiced: bool
    speech_probability: float | None
    timestamp_ms: int
    sequence: int


@dataclass
class _RealtimeSessionState:
    chunks: list[_PcmChunk] = field(default_factory=list)
    preroll: list[_PcmChunk] = field(default_factory=list)
    seen_sequences: set[int] = field(default_factory=set)
    buffered_ms: int = 0
    trailing_silence_ms: int = 0
    sample_rate: int | None = None
    last_sequence: int = 0
    has_voice: bool = False


class RealtimePcmSegmenter:
    def __init__(
        self,
        min_audio_ms: int,
        endpoint_silence_ms: int,
        max_audio_ms: int,
        preroll_ms: int,
        vad_energy_threshold: int,
        vad_provider: "VadProvider | None" = None,
    ) -> None:
        self.min_audio_ms = min_audio_ms
        self.endpoint_silence_ms = endpoint_silence_ms
        self.max_audio_ms = max_audio_ms
        self.preroll_ms = preroll_ms
        self.vad_energy_threshold = vad_energy_threshold
        if vad_provider is None:
            from app.vad import RmsVadProvider

            vad_provider = RmsVadProvider(vad_energy_threshold)
        self.vad_provider = vad_provider
        self._states: dict[str, _RealtimeSessionState] = {}

    def append(self, request: AsrTranscribeRequest) -> PcmAudioSegment | None:
        state = self._states.setdefault(request.sessionId, _RealtimeSessionState())
        if request.sequence in state.seen_sequences:
            return None
        state.seen_sequences.add(request.sequence)
        state.sample_rate = request.sampleRate
        state.last_sequence = request.sequence

        pcm = base64.b64decode(request.data, validate=True)
        duration_ms = audio_duration_ms(pcm, request.sampleRate)
        if duration_ms <= 0:
            return None

        decision = self.vad_provider.analyze(
            request.sessionId,
            pcm,
            request.sampleRate,
        )
        chunk = _PcmChunk(
            pcm=pcm,
            duration_ms=duration_ms,
            voiced=decision.voiced,
            speech_probability=decision.probability,
            timestamp_ms=request.timestampMs,
            sequence=request.sequence,
        )
        if not state.has_voice:
            return self._append_waiting_for_voice(state, chunk, request)

        return self._append_active_segment(state, chunk, request)

    def flush(self, session_id: str) -> PcmAudioSegment | None:
        state = self._states.get(session_id)
        if not state or not state.has_voice or not state.chunks or not state.sample_rate:
            return None

        audio = b"".join(chunk.pcm for chunk in state.chunks)
        segment = PcmAudioSegment(
            pcm=audio,
            sample_rate=state.sample_rate,
            end_sequence=state.last_sequence,
            duration_ms=state.buffered_ms,
            start_timestamp_ms=state.chunks[0].timestamp_ms,
            end_timestamp_ms=(
                state.chunks[-1].timestamp_ms + state.chunks[-1].duration_ms
            ),
        )
        reset_active_segment(state)
        self.vad_provider.reset_session(session_id)
        return segment

    def commit_boundary(self, session_id: str, boundary_ms: int) -> PcmAudioSegment | None:
        state = self._states.get(session_id)
        if not state or not state.has_voice or not state.chunks or not state.sample_rate:
            return None

        previous_chunks, next_chunks = split_chunks_at(
            state.chunks,
            boundary_ms,
            state.sample_rate,
        )
        if not previous_chunks or not any(chunk.voiced for chunk in previous_chunks):
            return None

        segment = segment_from_chunks(previous_chunks, state.sample_rate)
        retain_chunks_after_boundary(state, next_chunks, self.preroll_ms)
        return segment

    def close(self, session_id: str) -> None:
        self._states.pop(session_id, None)
        self.vad_provider.reset_session(session_id)

    def _append_waiting_for_voice(
        self,
        state: _RealtimeSessionState,
        chunk: _PcmChunk,
        request: AsrTranscribeRequest,
    ) -> PcmAudioSegment | None:
        if not chunk.voiced:
            state.preroll.append(chunk)
            trim_preroll(state, self.preroll_ms)
            return None

        state.has_voice = True
        state.chunks = [*state.preroll, chunk]
        state.preroll = []
        state.buffered_ms = sum(item.duration_ms for item in state.chunks)
        state.trailing_silence_ms = 0
        return self._emit_if_ready(state, request)

    def _append_active_segment(
        self,
        state: _RealtimeSessionState,
        chunk: _PcmChunk,
        request: AsrTranscribeRequest,
    ) -> PcmAudioSegment | None:
        state.chunks.append(chunk)
        state.buffered_ms += chunk.duration_ms
        if chunk.voiced:
            state.trailing_silence_ms = 0
        else:
            state.trailing_silence_ms += chunk.duration_ms
        return self._emit_if_ready(state, request)

    def _emit_if_ready(
        self,
        state: _RealtimeSessionState,
        request: AsrTranscribeRequest,
    ) -> PcmAudioSegment | None:
        has_endpoint = state.trailing_silence_ms >= self.endpoint_silence_ms
        reached_min = state.buffered_ms >= self.min_audio_ms
        reached_max = state.buffered_ms >= self.max_audio_ms
        if not ((reached_min and has_endpoint) or reached_max):
            return None

        audio = b"".join(chunk.pcm for chunk in state.chunks)
        segment = PcmAudioSegment(
            pcm=audio,
            sample_rate=request.sampleRate,
            end_sequence=request.sequence,
            duration_ms=state.buffered_ms,
            start_timestamp_ms=state.chunks[0].timestamp_ms,
            end_timestamp_ms=(
                state.chunks[-1].timestamp_ms + state.chunks[-1].duration_ms
            ),
        )
        reset_active_segment(state)
        self.vad_provider.reset_session(request.sessionId)
        return segment


def audio_duration_ms(pcm: bytes, sample_rate: int) -> int:
    if sample_rate <= 0:
        return 0
    return len(pcm) * 1000 // (sample_rate * 2)


def pcm16_rms(pcm: bytes) -> int:
    even_length = len(pcm) - (len(pcm) % 2)
    if even_length == 0:
        return 0

    total = 0
    count = 0
    for (sample,) in struct.iter_unpack("<h", pcm[:even_length]):
        total += sample * sample
        count += 1
    if count == 0:
        return 0
    return int((total / count) ** 0.5)


def trim_preroll(state: _RealtimeSessionState, max_ms: int) -> None:
    while sum(chunk.duration_ms for chunk in state.preroll) > max_ms:
        state.preroll.pop(0)


def reset_active_segment(state: _RealtimeSessionState) -> None:
    state.chunks = []
    state.preroll = []
    state.buffered_ms = 0
    state.trailing_silence_ms = 0
    state.sample_rate = None
    state.last_sequence = 0
    state.has_voice = False


def split_chunks_at(chunks: list[_PcmChunk], boundary_ms: int, sample_rate: int):
    previous: list[_PcmChunk] = []
    following: list[_PcmChunk] = []
    for chunk in chunks:
        chunk_end_ms = chunk.timestamp_ms + chunk.duration_ms
        if chunk_end_ms <= boundary_ms:
            previous.append(chunk)
            continue
        if chunk.timestamp_ms >= boundary_ms:
            following.append(chunk)
            continue

        sample_count = (boundary_ms - chunk.timestamp_ms) * sample_rate // 1000
        split_byte = max(0, min(len(chunk.pcm), sample_count * 2))
        left_pcm = chunk.pcm[:split_byte]
        right_pcm = chunk.pcm[split_byte:]
        if left_pcm:
            previous.append(copy_chunk(chunk, left_pcm, chunk.timestamp_ms, sample_rate))
        if right_pcm:
            following.append(copy_chunk(chunk, right_pcm, boundary_ms, sample_rate))
    return previous, following


def copy_chunk(
    source: _PcmChunk,
    pcm: bytes,
    timestamp_ms: int,
    sample_rate: int,
) -> _PcmChunk:
    return _PcmChunk(
        pcm=pcm,
        duration_ms=audio_duration_ms(pcm, sample_rate),
        voiced=source.voiced,
        speech_probability=source.speech_probability,
        timestamp_ms=timestamp_ms,
        sequence=source.sequence,
    )


def segment_from_chunks(
    chunks: list[_PcmChunk],
    sample_rate: int,
) -> PcmAudioSegment:
    return PcmAudioSegment(
        pcm=b"".join(chunk.pcm for chunk in chunks),
        sample_rate=sample_rate,
        end_sequence=chunks[-1].sequence,
        duration_ms=sum(chunk.duration_ms for chunk in chunks),
        start_timestamp_ms=chunks[0].timestamp_ms,
        end_timestamp_ms=chunks[-1].timestamp_ms + chunks[-1].duration_ms,
    )


def retain_chunks_after_boundary(
    state: _RealtimeSessionState,
    chunks: list[_PcmChunk],
    preroll_ms: int,
) -> None:
    if not chunks:
        reset_active_segment(state)
        return

    state.last_sequence = chunks[-1].sequence
    first_voice = next(
        (index for index, chunk in enumerate(chunks) if chunk.voiced),
        None,
    )
    if first_voice is None:
        state.chunks = []
        state.preroll = chunks
        trim_preroll(state, preroll_ms)
        state.buffered_ms = 0
        state.trailing_silence_ms = 0
        state.has_voice = False
        return

    state.chunks = chunks
    state.preroll = []
    state.buffered_ms = sum(chunk.duration_ms for chunk in chunks)
    state.trailing_silence_ms = trailing_silence_duration(chunks)
    state.has_voice = True


def trailing_silence_duration(chunks: list[_PcmChunk]) -> int:
    total = 0
    for chunk in reversed(chunks):
        if chunk.voiced:
            break
        total += chunk.duration_ms
    return total
