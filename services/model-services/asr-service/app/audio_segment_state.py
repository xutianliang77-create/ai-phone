from dataclasses import dataclass, field

from app.endpoint_policy import EndpointPolicy
from app.pcm_audio import audio_duration_ms


@dataclass(frozen=True)
class PcmAudioSegment:
    pcm: bytes
    sample_rate: int
    end_sequence: int
    duration_ms: int
    start_timestamp_ms: int
    end_timestamp_ms: int
    endpoint_reason: str


@dataclass(frozen=True)
class FrameVadDecision:
    sequence: int
    timestamp_ms: int
    duration_ms: int
    voiced: bool
    speech_probability: float | None
    provider: str
    preroll_ms: int


@dataclass(frozen=True)
class PcmChunk:
    pcm: bytes
    duration_ms: int
    voiced: bool
    speech_probability: float | None
    timestamp_ms: int
    sequence: int


@dataclass
class RealtimeSessionState:
    chunks: list[PcmChunk] = field(default_factory=list)
    preroll: list[PcmChunk] = field(default_factory=list)
    seen_sequences: set[int] = field(default_factory=set)
    buffered_ms: int = 0
    trailing_silence_ms: int = 0
    sample_rate: int | None = None
    last_sequence: int = 0
    has_voice: bool = False
    endpoint_policy: EndpointPolicy | None = None
    latest_vad: FrameVadDecision | None = None


def trim_preroll(state: RealtimeSessionState, max_ms: int) -> None:
    while sum(chunk.duration_ms for chunk in state.preroll) > max_ms:
        state.preroll.pop(0)


def reset_active_segment(state: RealtimeSessionState) -> None:
    state.chunks = []
    state.preroll = []
    state.buffered_ms = 0
    state.trailing_silence_ms = 0
    state.sample_rate = None
    state.last_sequence = 0
    state.has_voice = False


def split_chunks_at(chunks: list[PcmChunk], boundary_ms: int, sample_rate: int):
    previous: list[PcmChunk] = []
    following: list[PcmChunk] = []
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
    source: PcmChunk,
    pcm: bytes,
    timestamp_ms: int,
    sample_rate: int,
) -> PcmChunk:
    return PcmChunk(
        pcm=pcm,
        duration_ms=audio_duration_ms(pcm, sample_rate),
        voiced=source.voiced,
        speech_probability=source.speech_probability,
        timestamp_ms=timestamp_ms,
        sequence=source.sequence,
    )


def segment_from_chunks(
    chunks: list[PcmChunk],
    sample_rate: int,
    endpoint_reason: str,
) -> PcmAudioSegment:
    return PcmAudioSegment(
        pcm=b"".join(chunk.pcm for chunk in chunks),
        sample_rate=sample_rate,
        end_sequence=chunks[-1].sequence,
        duration_ms=sum(chunk.duration_ms for chunk in chunks),
        start_timestamp_ms=chunks[0].timestamp_ms,
        end_timestamp_ms=chunks[-1].timestamp_ms + chunks[-1].duration_ms,
        endpoint_reason=endpoint_reason,
    )


def retain_chunks_after_boundary(
    state: RealtimeSessionState,
    chunks: list[PcmChunk],
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


def trailing_silence_duration(chunks: list[PcmChunk]) -> int:
    total = 0
    for chunk in reversed(chunks):
        if chunk.voiced:
            break
        total += chunk.duration_ms
    return total
