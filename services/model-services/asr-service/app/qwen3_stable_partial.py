from __future__ import annotations

from dataclasses import dataclass, field
from time import monotonic
from typing import Callable

from app.audio_segment_state import ActivePcmAudio
from app.qwen3_context_guard import is_context_echo
from app.qwen3_partial_policy import (
    confirmed_readable_prefix,
    is_chinese_partial as _is_chinese_partial,
    language_evidence as _language_evidence,
)
from app.qwen3_partial_scheduler import (
    LatestPartialPushScheduler,
    PartialDecode,
    PartialPushMetrics,
    pcm16_to_float_16k,
)
from app.schemas import AsrTranscribeRequest, AsrTranscribeResponse
from app.sensevoice_engine import transcript_language

STABLE_PARTIAL_DECODE_SCHEDULE_MS = (500, 700, 900, 1000)
STABLE_PARTIAL_STEADY_DECODE_MS = 1000
STABLE_PARTIAL_MINIMUM_UNITS = 2
STABLE_PARTIAL_MIN_PUSH_AUDIO_MS = 40
STABLE_PARTIAL_UNFIXED_CHUNK_NUM = 4
STABLE_PARTIAL_UNFIXED_TOKEN_NUM = 5

@dataclass(frozen=True)
class StablePartialFinalization:
    segment_id: str
    revision: int | None
    text: str


@dataclass
class _PartialState:
    session_id: str
    segment_id: str
    source_language: str
    target_language: str
    context: str
    sample_rate: int
    source_bytes_consumed: int
    start_sequence: int
    start_timestamp_ms: int
    scheduler: LatestPartialPushScheduler
    previous_decode: str = ""
    last_partial: str = ""
    pending_extension: str = ""
    next_revision: int = 0
    decode_count: int = 0
    emitted_count: int = 0
    audio_started_at: float = 0.0
    final_fallback: str = ""


@dataclass
class _PartialMetrics:
    eligible_segment_count: int = 0
    decode_count: int = 0
    decision_count: int = 0
    emitted_count: int = 0
    rejection_counts: dict[str, int] = field(default_factory=dict)
    language_evidence_counts: dict[str, int] = field(default_factory=dict)
    language_gate_counts: dict[str, int] = field(default_factory=dict)
    first_stable_partial_latency_ms: float | None = None
    last_stable_partial_latency_ms: float | None = None
    pushes: PartialPushMetrics = field(default_factory=PartialPushMetrics)


class StableReadablePartialCoordinator:
    def __init__(self, runner: object, enabled: bool) -> None:
        new_state = getattr(runner, "new_streaming_state", None)
        push = getattr(runner, "push_streaming", None)
        self.enabled = bool(enabled and callable(new_state) and callable(push))
        self._new_state: Callable[..., object] | None = new_state
        self._push: Callable[..., tuple[int, str, str]] | None = push
        self._states: dict[str, _PartialState] = {}
        self._metrics: dict[str, _PartialMetrics] = {}

    async def observe(
        self,
        request: AsrTranscribeRequest,
        active_audio: ActivePcmAudio | None,
        context: str,
    ) -> AsrTranscribeResponse | None:
        if not self._eligible(request) or active_audio is None:
            return None
        state = self._state_for(request, active_audio, context)
        if len(active_audio.pcm) < state.source_bytes_consumed:
            state = self._replace_state(request, active_audio, context)
        delta = active_audio.pcm[state.source_bytes_consumed :]
        state.source_bytes_consumed = len(active_audio.pcm)
        state.scheduler.append(delta, active_audio.end_timestamp_ms)
        response = self._completed_response(
            state,
            state.scheduler.take_completed(),
        )
        state.scheduler.start()
        return response

    def _completed_response(
        self,
        state: _PartialState,
        result: PartialDecode | None,
        publish: bool = True,
    ) -> AsrTranscribeResponse | None:
        if result is None or result.decode_id <= state.decode_count:
            return None
        completed = result.decode_id - state.decode_count
        state.decode_count = result.decode_id
        metrics = self._metrics_for(state.session_id)
        metrics.decode_count += completed
        metrics.decision_count += 1
        language_evidence = _language_evidence(result.model_language)
        self._count(metrics.language_evidence_counts, language_evidence)

        text = str(result.text or "").strip()
        if not text:
            state.pending_extension = ""
            self._reject(metrics, "no_text")
            return None
        confirmed = confirmed_readable_prefix(
            state.previous_decode,
            text,
            STABLE_PARTIAL_MINIMUM_UNITS,
        )
        state.previous_decode = text
        if not confirmed:
            state.pending_extension = ""
            self._reject(metrics, "insufficient_units")
            return None
        if confirmed == state.last_partial:
            state.pending_extension = ""
            self._reject(metrics, "duplicate_partial")
            return None
        if state.last_partial and not confirmed.startswith(state.last_partial):
            state.pending_extension = ""
            self._reject(metrics, "backtrack")
            return None
        if not _is_chinese_partial(state.source_language, result.model_language):
            state.pending_extension = ""
            self._count(metrics.language_gate_counts, language_evidence)
            self._reject(metrics, "language_gate")
            return None
        if is_context_echo(confirmed, state.context):
            state.pending_extension = ""
            self._reject(metrics, "context_echo")
            return None
        if not publish:
            state.final_fallback = confirmed
            return None
        if state.last_partial:
            pending = state.pending_extension
            if not pending or not confirmed.startswith(pending):
                state.pending_extension = confirmed
                self._reject(metrics, "extension_pending")
                return None
            state.pending_extension = confirmed if confirmed != pending else ""
            confirmed = pending

        state.last_partial = confirmed
        revision = state.next_revision
        state.next_revision += 1
        state.emitted_count += 1
        metrics.emitted_count += 1
        latency_ms = round((monotonic() - state.audio_started_at) * 1000, 3)
        metrics.first_stable_partial_latency_ms = (
            metrics.first_stable_partial_latency_ms
            if metrics.first_stable_partial_latency_ms is not None
            else latency_ms
        )
        metrics.last_stable_partial_latency_ms = latency_ms
        return AsrTranscribeResponse(
            segmentId=state.segment_id,
            revision=revision,
            isFinal=False,
            text=confirmed,
            language=transcript_language(
                confirmed,
                state.source_language,
                state.target_language,
            ),
            timing={
                "startMs": state.start_timestamp_ms,
                "endMs": result.end_timestamp_ms,
                "source": "client",
            },
        )

    async def finish(self, session_id: str) -> StablePartialFinalization | None:
        state = self._states.pop(session_id, None)
        if state is None:
            return None
        if not state.last_partial:
            try:
                result = await state.scheduler.wait_for_completed()
            except Exception:
                result = None
            self._completed_response(state, result, publish=False)
        state.scheduler.invalidate()
        return StablePartialFinalization(
            segment_id=state.segment_id,
            revision=(state.next_revision if state.emitted_count else None),
            text=state.last_partial or state.final_fallback,
        )

    def diagnostics(self, session_id: str) -> dict[str, object]:
        metrics = self._metrics.get(session_id, _PartialMetrics())
        state = self._states.get(session_id)
        return {
            "enabled": self.enabled,
            "policy": "qwen17_latest_only_40ms_extension_survival_zh_v4",
            "minimumPushAudioMs": STABLE_PARTIAL_MIN_PUSH_AUDIO_MS,
            "eligibleSegmentCount": metrics.eligible_segment_count,
            "activeSegment": session_id in self._states,
            "decodeCount": metrics.decode_count,
            "decisionCount": metrics.decision_count,
            "emittedCount": metrics.emitted_count,
            "rejectionCounts": dict(metrics.rejection_counts),
            "languageEvidenceSource": "qwen_streaming_state_label",
            "languageEvidenceCounts": dict(metrics.language_evidence_counts),
            "languageGateCounts": dict(metrics.language_gate_counts),
            "scheduledPushCount": metrics.pushes.scheduled_count,
            "completedPushCount": metrics.pushes.completed_count,
            "coalescedObservationCount": metrics.pushes.coalesced_observation_count,
            "invalidatedPushCount": metrics.pushes.invalidated_count,
            "inFlight": metrics.pushes.active_count > 0,
            "resultReady": bool(state and state.scheduler.result_ready),
            "pendingAudioMs": round(
                state.scheduler.pending_audio_ms if state else 0.0,
                3,
            ),
            "maxPendingAudioMs": round(metrics.pushes.max_pending_audio_ms, 3),
            **(
                {
                    "averagePushLatencyMs": round(
                        metrics.pushes.total_latency_ms
                        / metrics.pushes.timed_count, 3,
                    ),
                    "maxPushLatencyMs": round(metrics.pushes.max_latency_ms, 3),
                }
                if metrics.pushes.timed_count else {}
            ),
            **(
                {
                    "firstStablePartialLatencyMs": (
                        metrics.first_stable_partial_latency_ms
                    )
                }
                if metrics.first_stable_partial_latency_ms is not None else {}
            ),
            **(
                {"lastStablePartialLatencyMs": metrics.last_stable_partial_latency_ms}
                if metrics.last_stable_partial_latency_ms is not None else {}
            ),
        }

    def clear(self, session_id: str) -> None:
        state = self._states.pop(session_id, None)
        if state is not None:
            state.scheduler.invalidate()
        self._metrics.pop(session_id, None)
    def _eligible(self, request: AsrTranscribeRequest) -> bool:
        if not self.enabled or request.mode != "listening":
            return False
        language = request.sourceLanguage.strip().lower().replace("_", "-")
        return language in {"auto", "zh", "zh-cn", "chinese"}

    def _state_for(
        self,
        request: AsrTranscribeRequest,
        audio: ActivePcmAudio,
        context: str,
    ) -> _PartialState:
        state = self._states.get(request.sessionId)
        if (
            state is None
            or state.sample_rate != audio.sample_rate
            or state.start_sequence != audio.start_sequence
        ):
            return self._replace_state(request, audio, context)
        return state

    def _replace_state(
        self,
        request: AsrTranscribeRequest,
        audio: ActivePcmAudio,
        context: str,
    ) -> _PartialState:
        if self._new_state is None or self._push is None:
            raise RuntimeError("stable partial runner is unavailable")
        previous = self._states.get(request.sessionId)
        if previous is not None:
            previous.scheduler.invalidate()
        requested_language = request.sourceLanguage.strip().lower().replace("_", "-")
        language = "Chinese" if requested_language != "auto" else None
        metrics = self._metrics_for(request.sessionId)
        model_state = self._new_state(language, context)
        state = _PartialState(
            session_id=request.sessionId,
            segment_id=f"qwen3_seg_{audio.start_sequence}",
            source_language=request.sourceLanguage,
            target_language=request.targetLanguage,
            context=context,
            sample_rate=audio.sample_rate,
            source_bytes_consumed=0,
            start_sequence=audio.start_sequence,
            start_timestamp_ms=audio.start_timestamp_ms,
            scheduler=LatestPartialPushScheduler(
                self._push,
                model_state,
                audio.sample_rate,
                metrics.pushes,
                STABLE_PARTIAL_MIN_PUSH_AUDIO_MS,
            ),
            audio_started_at=monotonic() - audio.duration_ms / 1000,
        )
        self._states[request.sessionId] = state
        metrics.eligible_segment_count += 1
        return state

    def _metrics_for(self, session_id: str) -> _PartialMetrics:
        return self._metrics.setdefault(session_id, _PartialMetrics())

    @staticmethod
    def _reject(metrics: _PartialMetrics, reason: str) -> None:
        StableReadablePartialCoordinator._count(metrics.rejection_counts, reason)

    @staticmethod
    def _count(counts: dict[str, int], key: str) -> None:
        counts[key] = counts.get(key, 0) + 1
