import base64
from dataclasses import dataclass, field
import struct

from app.schemas import AsrTranscribeRequest


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


@dataclass(frozen=True)
class _PcmChunk:
    pcm: bytes
    duration_ms: int
    voiced: bool


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
    ) -> None:
        self.min_audio_ms = min_audio_ms
        self.endpoint_silence_ms = endpoint_silence_ms
        self.max_audio_ms = max_audio_ms
        self.preroll_ms = preroll_ms
        self.vad_energy_threshold = vad_energy_threshold
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

        chunk = _PcmChunk(
            pcm=pcm,
            duration_ms=duration_ms,
            voiced=pcm16_rms(pcm) > self.vad_energy_threshold,
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
        )
        reset_active_segment(state)
        return segment

    def close(self, session_id: str) -> None:
        self._states.pop(session_id, None)

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
        )
        reset_active_segment(state)
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
