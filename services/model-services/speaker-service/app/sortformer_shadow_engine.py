import asyncio
import base64
from dataclasses import dataclass, field
from pathlib import Path

from app.pcm_stream_buffer import PcmStreamBuffer
from app.schemas import CreateSpeakerSessionRequest, SpeakerAudioFrame, SpeakerSpan
from app.sortformer_streaming_runtime import (
    SAMPLES_PER_DIAR_FRAME,
    SortformerStreamingRuntime,
    StreamingProfile,
    StreamingRuntimeState,
)
from app.speaker_activity_decoder import SpeakerActivityDecoder


@dataclass
class _Session:
    max_speakers: int
    runtime_state: StreamingRuntimeState
    audio: PcmStreamBuffer = field(default_factory=PcmStreamBuffer)
    decoder: SpeakerActivityDecoder | None = None
    timeline_origin_ms: int | None = None
    last_sequence: int = 0
    resume_pending: bool = False
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class SortformerShadowEngine:
    def __init__(
        self,
        model_id: str,
        profile: StreamingProfile,
        onset: float = 0.5,
        offset: float = 0.5,
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
        model.eval()
        self._runtime = SortformerStreamingRuntime(model, profile)
        self._onset = onset
        self._offset = offset
        self._sessions: dict[str, _Session] = {}

    async def create_session(self, request: CreateSpeakerSessionRequest) -> None:
        self._sessions[request.sessionId] = _Session(
            max_speakers=request.options.maxSpeakers,
            runtime_state=self._runtime.create_state(),
        )

    async def push_audio(self, frame: SpeakerAudioFrame) -> list[SpeakerSpan]:
        session = self._session(frame.sessionId)
        async with session.lock:
            if not self._append(session, frame):
                return []
            if not self._runtime.ready(session.runtime_state, session.audio):
                return []
            return await asyncio.to_thread(self._process, session, False)

    async def flush(self, session_id: str) -> list[SpeakerSpan]:
        session = self._session(session_id)
        async with session.lock:
            spans = await asyncio.to_thread(self._process, session, True)
            session.audio.prepare_for_resume(
                session.runtime_state.next_diar_frame * SAMPLES_PER_DIAR_FRAME,
            )
            session.resume_pending = True
            return spans

    async def close_session(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def _append(self, session: _Session, frame: SpeakerAudioFrame) -> bool:
        if frame.sequence <= session.last_sequence:
            return False
        session.last_sequence = frame.sequence
        if session.timeline_origin_ms is None:
            session.timeline_origin_ms = frame.timestampMs
            session.resume_pending = False
            session.decoder = SpeakerActivityDecoder(
                max_speakers=session.max_speakers,
                timeline_origin_ms=frame.timestampMs,
                onset=self._onset,
                offset=self._offset,
            )
        elif session.resume_pending and session.decoder is not None:
            session.decoder.align_next_frame(frame.timestampMs)
            session.resume_pending = False
        session.audio.append(
            base64.b64decode(frame.data, validate=True),
            frame.sampleRate,
        )
        return True

    def _process(self, session: _Session, flush: bool) -> list[SpeakerSpan]:
        if session.decoder is None:
            return []
        return self._runtime.process_available(
            session.runtime_state,
            session.audio,
            session.decoder,
            flush,
        )

    def _session(self, session_id: str) -> _Session:
        session = self._sessions.get(session_id)
        if session is None:
            raise KeyError("speaker session not found")
        return session
