import base64
import uuid

from app.schemas import (
    CreateSpeakerSessionRequest,
    SpeakerAudioFrame,
    SpeakerOptions,
    SpeakerSpan,
)
from app.sortformer_shadow_engine import SortformerShadowEngine
from app.sortformer_streaming_runtime import StreamingProfile


class HighContextSortformerRunner:
    def __init__(
        self,
        model_id: str,
        device: str = "cpu",
        chunk_len: int = 62,
        chunk_left_context: int = 1,
        chunk_right_context: int = 1,
        fifo_len: int = 62,
        cache_update_period: int = 62,
        cache_len: int = 188,
        onset: float = 0.5,
        offset: float = 0.5,
        min_duration_on_ms: int = 100,
        min_duration_off_ms: int = 320,
    ) -> None:
        self.model_id = model_id
        self.profile = {
            "provider": "sortformer_high_context",
            "model": model_id,
            "device": device,
            "chunkLen": chunk_len,
            "chunkLeftContext": chunk_left_context,
            "chunkRightContext": chunk_right_context,
            "fifoLen": fifo_len,
            "speakerCacheUpdatePeriod": cache_update_period,
            "speakerCacheLen": cache_len,
            "onset": onset,
            "offset": offset,
            "minDurationOnMs": min_duration_on_ms,
            "minDurationOffMs": min_duration_off_ms,
        }
        self._engine = SortformerShadowEngine(
            model_id=model_id,
            profile=StreamingProfile(
                chunk_len=chunk_len,
                chunk_left_context=chunk_left_context,
                chunk_right_context=chunk_right_context,
                fifo_len=fifo_len,
                spkcache_update_period=cache_update_period,
                spkcache_len=cache_len,
            ),
            onset=onset,
            offset=offset,
            device=device,
            min_duration_on_ms=min_duration_on_ms,
            min_duration_off_ms=min_duration_off_ms,
        )

    async def revise(
        self,
        pcm: bytes,
        sample_rate: int,
        frame_ms: int = 80,
    ) -> list[SpeakerSpan]:
        session_id = f"high-context-{uuid.uuid4()}"
        await self._engine.create_session(CreateSpeakerSessionRequest(
            sessionId=session_id,
            options=SpeakerOptions(
                mode="diarization",
                maxSpeakers=4,
                allowVoiceIdentity=False,
            ),
        ))
        indexed: dict[tuple[str, int, bool], SpeakerSpan] = {}
        try:
            bytes_per_frame = sample_rate * 2 * frame_ms // 1000
            timestamp_ms = 0
            sequence = 0
            for offset in range(0, len(pcm), bytes_per_frame):
                frame = pcm[offset:offset + bytes_per_frame]
                sequence += 1
                spans = await self._engine.push_audio(SpeakerAudioFrame(
                    type="audio.frame",
                    sessionId=session_id,
                    sequence=sequence,
                    timestampMs=timestamp_ms,
                    format="pcm16",
                    sampleRate=sample_rate,
                    data=base64.b64encode(frame).decode("ascii"),
                ))
                timestamp_ms += len(frame) * 1000 // (sample_rate * 2)
                retain(indexed, spans)
            retain(indexed, await self._engine.flush(session_id))
        finally:
            await self._engine.close_session(session_id)
        return sorted(
            (span for span in indexed.values() if span.final),
            key=lambda span: (span.startMs, span.endMs, span.speakerId),
        )


def retain(
    indexed: dict[tuple[str, int, bool], SpeakerSpan],
    spans: list[SpeakerSpan],
) -> None:
    for span in spans:
        key = (span.speakerId, span.startMs, span.overlap)
        previous = indexed.get(key)
        if previous is None or span.final or span.endMs >= previous.endMs:
            indexed[key] = span
