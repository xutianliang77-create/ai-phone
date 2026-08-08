import base64
from typing import TYPE_CHECKING

from app.pcm_audio import PcmSessionBuffer, audio_duration_ms, pcm16_rms
from app.schemas import AsrTranscribeRequest
from app.endpoint_policy import EndpointPolicy, segment_vad_context, uniform_endpoint_policies
from app.audio_segment_state import (
    ActivePcmAudio,
    FrameVadDecision,
    PcmAudioSegment,
    PcmChunk,
    RealtimeSessionState,
    reset_active_segment,
    retain_chunks_after_boundary,
    segment_from_chunks,
    split_chunks_at,
    trim_preroll,
    voiced_duration_ms,
)

if TYPE_CHECKING:
    from app.vad import VadProvider


class RealtimePcmSegmenter:
    def __init__(
        self,
        min_audio_ms: int,
        endpoint_silence_ms: int,
        max_audio_ms: int,
        preroll_ms: int,
        vad_energy_threshold: int,
        vad_provider: "VadProvider | None" = None,
        endpoint_policies: dict[str, EndpointPolicy] | None = None,
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
        self.endpoint_policies = endpoint_policies or uniform_endpoint_policies(
            min_audio_ms,
            endpoint_silence_ms,
            max_audio_ms,
            preroll_ms,
        )
        self._states: dict[str, RealtimeSessionState] = {}

    def append(self, request: AsrTranscribeRequest) -> PcmAudioSegment | None:
        state = self._states.setdefault(request.sessionId, RealtimeSessionState())
        policy = self.endpoint_policies.get(
            request.mode,
            self.endpoint_policies["conversation"],
        )
        if state.endpoint_policy is None:
            state.endpoint_policy = policy
        elif state.endpoint_policy.mode != policy.mode:
            raise ValueError("ASR endpoint mode cannot change during a session")
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
            threshold=policy.vad_threshold,
        )
        state.latest_vad = FrameVadDecision(
            sequence=request.sequence,
            timestamp_ms=request.timestampMs,
            duration_ms=duration_ms,
            voiced=decision.voiced,
            speech_probability=decision.probability,
            provider=decision.provider,
            preroll_ms=policy.preroll_ms,
        )
        chunk = PcmChunk(
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
        if state.voiced_ms < self._policy(state).min_voiced_ms:
            reset_active_segment(state)
            self.vad_provider.reset_session(session_id)
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
            endpoint_reason="flush",
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
        if voiced_duration_ms(previous_chunks) < self._policy(state).min_voiced_ms:
            return None

        segment = segment_from_chunks(
            previous_chunks,
            state.sample_rate,
            endpoint_reason="speaker_boundary",
        )
        retain_chunks_after_boundary(
            state,
            next_chunks,
            self._policy(state).preroll_ms,
        )
        return segment

    def diagnostics(self, session_id: str) -> dict[str, object]:
        return {
            **self.vad_provider.diagnostics(session_id),
            "endpointPolicy": self._policy(self._states.get(session_id)).diagnostics(),
        }

    def segment_vad_context(self, session_id: str, endpoint_reason: str):
        return segment_vad_context(self.diagnostics(session_id), endpoint_reason)

    def frame_vad_decision(self, session_id: str) -> FrameVadDecision | None:
        state = self._states.get(session_id)
        return state.latest_vad if state else None

    def active_audio(self, session_id: str) -> ActivePcmAudio | None:
        state = self._states.get(session_id)
        if not state or not state.has_voice or not state.chunks or not state.sample_rate:
            return None
        return ActivePcmAudio(
            pcm=b"".join(chunk.pcm for chunk in state.chunks),
            sample_rate=state.sample_rate,
            start_sequence=state.chunks[0].sequence,
            end_sequence=state.chunks[-1].sequence,
            duration_ms=state.buffered_ms,
            start_timestamp_ms=state.chunks[0].timestamp_ms,
            end_timestamp_ms=(
                state.chunks[-1].timestamp_ms + state.chunks[-1].duration_ms
            ),
        )

    def close(self, session_id: str) -> None:
        self._states.pop(session_id, None)
        self.vad_provider.close_session(session_id)

    def _policy(self, state: RealtimeSessionState | None) -> EndpointPolicy:
        return (
            state.endpoint_policy
            if state and state.endpoint_policy
            else self.endpoint_policies["conversation"]
        )

    def _append_waiting_for_voice(
        self,
        state: RealtimeSessionState,
        chunk: PcmChunk,
        request: AsrTranscribeRequest,
    ) -> PcmAudioSegment | None:
        if not chunk.voiced:
            state.preroll.append(chunk)
            trim_preroll(state, self._policy(state).preroll_ms)
            return None

        state.has_voice = True
        state.chunks = [*state.preroll, chunk]
        state.preroll = []
        state.buffered_ms = sum(item.duration_ms for item in state.chunks)
        state.voiced_ms = chunk.duration_ms
        state.trailing_silence_ms = 0
        return self._emit_if_ready(state, request)

    def _append_active_segment(
        self,
        state: RealtimeSessionState,
        chunk: PcmChunk,
        request: AsrTranscribeRequest,
    ) -> PcmAudioSegment | None:
        state.chunks.append(chunk)
        state.buffered_ms += chunk.duration_ms
        if chunk.voiced:
            state.voiced_ms += chunk.duration_ms
            state.trailing_silence_ms = 0
        else:
            state.trailing_silence_ms += chunk.duration_ms
        return self._emit_if_ready(state, request)

    def _emit_if_ready(
        self,
        state: RealtimeSessionState,
        request: AsrTranscribeRequest,
    ) -> PcmAudioSegment | None:
        policy = self._policy(state)
        has_endpoint = state.trailing_silence_ms >= policy.endpoint_silence_ms
        reached_min = state.buffered_ms >= policy.min_audio_ms
        reached_max = state.buffered_ms >= policy.max_audio_ms
        if not ((reached_min and has_endpoint) or reached_max):
            return None
        if state.voiced_ms < policy.min_voiced_ms:
            reset_active_segment(state)
            self.vad_provider.reset_session(request.sessionId)
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
            endpoint_reason="silence" if has_endpoint else "max_duration",
        )
        reset_active_segment(state)
        self.vad_provider.reset_session(request.sessionId)
        return segment
