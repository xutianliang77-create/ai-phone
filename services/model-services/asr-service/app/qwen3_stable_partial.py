from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from time import monotonic
from typing import Callable
import unicodedata

import numpy as np

from app.audio_segment_state import ActivePcmAudio
from app.qwen3_context_guard import is_context_echo
from app.schemas import AsrTranscribeRequest, AsrTranscribeResponse
from app.sensevoice_engine import transcript_language


STABLE_PARTIAL_DECODE_SCHEDULE_MS = (500, 700, 900, 1000)
STABLE_PARTIAL_STEADY_DECODE_MS = 1000
STABLE_PARTIAL_MINIMUM_UNITS = 2
STABLE_PARTIAL_UNFIXED_CHUNK_NUM = 4
STABLE_PARTIAL_UNFIXED_TOKEN_NUM = 5
IGNORED_DISCOURSE_FILLERS = frozenset({"啊", "呃", "嗯", "哦"})


@dataclass(frozen=True)
class StablePartialFinalization:
    segment_id: str
    revision: int | None
    text: str


@dataclass
class _PartialState:
    segment_id: str
    model_state: object
    sample_rate: int
    source_bytes_consumed: int
    start_sequence: int
    start_timestamp_ms: int
    previous_decode: str = ""
    last_partial: str = ""
    next_revision: int = 0
    decode_count: int = 0
    emitted_count: int = 0
    audio_started_at: float = 0.0


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
        if not delta or self._push is None:
            return None

        samples = pcm16_to_float_16k(delta, active_audio.sample_rate)
        decode_id, text, model_language = await asyncio.to_thread(
            self._push,
            state.model_state,
            samples,
        )
        if decode_id <= state.decode_count:
            return None
        completed = decode_id - state.decode_count
        state.decode_count = decode_id
        metrics = self._metrics_for(request.sessionId)
        metrics.decode_count += completed
        metrics.decision_count += 1
        language_evidence = _language_evidence(model_language)
        self._count(metrics.language_evidence_counts, language_evidence)

        text = str(text or "").strip()
        if not text:
            self._reject(metrics, "no_text")
            return None
        confirmed = confirmed_readable_prefix(
            state.previous_decode,
            text,
            STABLE_PARTIAL_MINIMUM_UNITS,
        )
        state.previous_decode = text
        if not confirmed:
            self._reject(metrics, "insufficient_units")
            return None
        if confirmed == state.last_partial:
            self._reject(metrics, "duplicate_partial")
            return None
        if state.last_partial and not confirmed.startswith(state.last_partial):
            self._reject(metrics, "backtrack")
            return None
        if not _is_chinese_partial(request.sourceLanguage, model_language):
            self._count(metrics.language_gate_counts, language_evidence)
            self._reject(metrics, "language_gate")
            return None
        if is_context_echo(confirmed, context):
            self._reject(metrics, "context_echo")
            return None

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
                request.sourceLanguage,
                request.targetLanguage,
            ),
            timing={
                "startMs": state.start_timestamp_ms,
                "endMs": active_audio.end_timestamp_ms,
                "source": "client",
            },
        )

    def finish(self, session_id: str) -> StablePartialFinalization | None:
        state = self._states.pop(session_id, None)
        if state is None:
            return None
        return StablePartialFinalization(
            segment_id=state.segment_id,
            revision=(state.next_revision if state.emitted_count else None),
            text=state.last_partial,
        )

    def diagnostics(self, session_id: str) -> dict[str, object]:
        metrics = self._metrics.get(session_id, _PartialMetrics())
        return {
            "enabled": self.enabled,
            "policy": "qwen17_adjacent_prefix_zh_v1",
            "eligibleSegmentCount": metrics.eligible_segment_count,
            "activeSegment": session_id in self._states,
            "decodeCount": metrics.decode_count,
            "decisionCount": metrics.decision_count,
            "emittedCount": metrics.emitted_count,
            "rejectionCounts": dict(metrics.rejection_counts),
            "languageEvidenceSource": "qwen_streaming_state_label",
            "languageEvidenceCounts": dict(metrics.language_evidence_counts),
            "languageGateCounts": dict(metrics.language_gate_counts),
            **(
                {
                    "firstStablePartialLatencyMs": (
                        metrics.first_stable_partial_latency_ms
                    )
                }
                if metrics.first_stable_partial_latency_ms is not None
                else {}
            ),
            **(
                {"lastStablePartialLatencyMs": metrics.last_stable_partial_latency_ms}
                if metrics.last_stable_partial_latency_ms is not None
                else {}
            ),
        }

    def clear(self, session_id: str) -> None:
        self._states.pop(session_id, None)
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
        if self._new_state is None:
            raise RuntimeError("stable partial runner is unavailable")
        requested_language = request.sourceLanguage.strip().lower().replace("_", "-")
        language = "Chinese" if requested_language != "auto" else None
        state = _PartialState(
            segment_id=f"qwen3_seg_{audio.start_sequence}",
            model_state=self._new_state(language, context),
            sample_rate=audio.sample_rate,
            source_bytes_consumed=0,
            start_sequence=audio.start_sequence,
            start_timestamp_ms=audio.start_timestamp_ms,
            audio_started_at=monotonic() - audio.duration_ms / 1000,
        )
        self._states[request.sessionId] = state
        self._metrics_for(request.sessionId).eligible_segment_count += 1
        return state

    def _metrics_for(self, session_id: str) -> _PartialMetrics:
        return self._metrics.setdefault(session_id, _PartialMetrics())

    @staticmethod
    def _reject(metrics: _PartialMetrics, reason: str) -> None:
        StableReadablePartialCoordinator._count(metrics.rejection_counts, reason)

    @staticmethod
    def _count(counts: dict[str, int], key: str) -> None:
        counts[key] = counts.get(key, 0) + 1


def confirmed_readable_prefix(
    previous: str,
    current: str,
    minimum_units: int,
) -> str | None:
    if not previous or not current:
        return None
    index = 0
    limit = min(len(previous), len(current))
    while index < limit and previous[index] == current[index]:
        index += 1
    prefix = current[:index].rstrip()
    return prefix if len(normalized_content(prefix)) >= minimum_units else None


def normalized_content(text: str) -> str:
    return "".join(
        character
        for character in str(text or "")
        if unicodedata.category(character)[:1] in {"L", "N"}
        and character not in IGNORED_DISCOURSE_FILLERS
    )


def pcm16_to_float_16k(pcm: bytes, sample_rate: int) -> np.ndarray:
    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
    if sample_rate == 16000:
        return samples
    if sample_rate != 24000:
        raise ValueError(f"unsupported streaming sample rate: {sample_rate}")
    from scipy.signal import resample_poly

    return resample_poly(samples, 2, 3).astype(np.float32, copy=False)


def _is_chinese_partial(source_language: str, model_language: str) -> bool:
    source = source_language.strip().lower().replace("_", "-")
    if source != "auto":
        return True
    detected = str(model_language or "").strip().lower().replace("_", "-")
    return detected in {"zh", "zh-cn", "chinese"}


def _language_evidence(model_language: str) -> str:
    detected = str(model_language or "").strip().lower().replace("_", "-")
    if not detected:
        return "empty"
    parts = {
        part.strip()
        for part in detected.replace(";", ",").split(",")
        if part.strip()
    }
    chinese = {"zh", "zh-cn", "chinese"}
    english = {"en", "en-us", "en-gb", "english"}
    if parts and parts <= chinese:
        return "zh"
    if parts and parts <= english:
        return "en"
    if parts and parts <= chinese | english and parts & chinese and parts & english:
        return "zh_en"
    return "other"
