from __future__ import annotations

import logging
from time import perf_counter

import numpy as np

from candidate_service.audio import language_code
from candidate_service.policy import (
    has_adjacent_duplicate,
    is_low_evidence_silence_hallucination,
)
from candidate_service.revision import RevisionResult
from candidate_service.state import SessionState, Utterance

logger = logging.getLogger(__name__)


class CandidateFinalizeMixin:
    def _finalize(
        self,
        session: SessionState,
        reason: str,
        *,
        allow_streaming_fallback: bool = True,
    ) -> dict[str, object] | None:
        utterance = session.utterance
        if utterance is None:
            return None
        text, model_language = self._authoritative_final(
            session,
            utterance,
            allow_streaming_fallback=allow_streaming_fallback,
        )
        text = str(text or "").strip()
        response = None
        suppressed = text and is_low_evidence_silence_hallucination(
            text=text,
            source_language=session.source_language,
            endpoint_reason=reason,
            voiced_ms=utterance.voiced_ms,
            max_speech_probability=utterance.max_speech_probability,
        )
        if suppressed:
            self._metrics["silenceHallucinationsSuppressed"] = (
                int(self._metrics["silenceHallucinationsSuppressed"] or 0) + 1
            )
        elif text:
            response = self._response(
                utterance,
                text,
                language_code(model_language, session.source_language),
                reason,
            )
            session.responses.append(response)
            self._metrics["finals"] = int(self._metrics["finals"] or 0) + 1
            session.finals += 1
            if has_adjacent_duplicate(text):
                self._schedule_revision(
                    session,
                    utterance,
                    text,
                    np.concatenate(utterance.audio),
                    model_language,
                )
        session.utterance = None
        return response

    def _authoritative_final(
        self,
        session: SessionState,
        utterance: Utterance,
        *,
        allow_streaming_fallback: bool = True,
    ) -> tuple[str, str]:
        batch_transcribe = getattr(self.qwen, "transcribe_final", None)
        if batch_transcribe is not None and utterance.final_audio:
            audio = np.concatenate(utterance.final_audio)
            detected_language = str(
                getattr(utterance.qwen_state, "language", "") or ""
            )
            started_at = perf_counter()
            try:
                with self._gpu_lock:
                    text, language = batch_transcribe(
                        audio,
                        session.source_language,
                        detected_language,
                    )
            except Exception:
                logger.exception(
                    "Qwen batch final failed; falling back to streaming final",
                    extra={"sessionId": session.session_id},
                )
            else:
                latency_ms = round((perf_counter() - started_at) * 1000, 3)
                self._metrics["lastBatchFinalLatencyMs"] = latency_ms
                session.last_batch_final_latency_ms = latency_ms
                if str(text or "").strip():
                    self._metrics["batchFinals"] = (
                        int(self._metrics["batchFinals"] or 0) + 1
                    )
                    session.batch_finals += 1
                    return text, language

            self._metrics["batchFinalFallbacks"] = (
                int(self._metrics["batchFinalFallbacks"] or 0) + 1
            )
            session.batch_final_fallbacks += 1

        if not allow_streaming_fallback:
            return "", str(
                getattr(utterance.qwen_state, "language", "") or ""
            )
        with self._gpu_lock:
            return self.qwen.finish(utterance.qwen_state)

    def _record_boundary_fallback(self) -> None:
        self._metrics["boundarySplitFallbacks"] = (
            int(self._metrics["boundarySplitFallbacks"] or 0) + 1
        )

    def _schedule_revision(
        self,
        session: SessionState,
        utterance: Utterance,
        draft_text: str,
        audio: np.ndarray,
        model_language: str,
    ) -> None:
        self._metrics["revisionCandidates"] = (
            int(self._metrics["revisionCandidates"] or 0) + 1
        )

        def completed(result: RevisionResult) -> None:
            with self._state_lock:
                current = self._sessions.get(session.session_id)
                if current is None:
                    return
                if result.error:
                    self._metrics["revisionErrors"] = (
                        int(self._metrics["revisionErrors"] or 0) + 1
                    )
                    return
                self._metrics["lastRevisionLatencyMs"] = round(
                    float(result.latency_ms or 0),
                    3,
                )
                decision = result.decision or {}
                if decision.get("selectedLane") != "surgical_duplicate_patch":
                    self._metrics["revisionFallbacks"] = (
                        int(self._metrics["revisionFallbacks"] or 0) + 1
                    )
                    return
                self._metrics["revisionsApplied"] = (
                    int(self._metrics["revisionsApplied"] or 0) + 1
                )
                current.responses.append(
                    self._response(
                        utterance,
                        str(decision["text"]),
                        language_code(
                            model_language,
                            current.source_language,
                        ),
                        "silence",
                    )
                )

        self._revision_worker.submit(draft_text, audio, completed)

    def _response(
        self,
        utterance: Utterance,
        text: str,
        language: str,
        endpoint_reason: str | None,
    ) -> dict[str, object]:
        response: dict[str, object] = {
            "segmentId": utterance.segment_id,
            "revision": utterance.next_revision,
            "text": text,
            "language": language,
            "timing": {
                "startMs": utterance.start_ms,
                "endMs": utterance.start_ms + round(utterance.samples / 16),
                "source": "server",
            },
        }
        utterance.next_revision += 1
        if endpoint_reason:
            response["endpointReason"] = endpoint_reason
        return response

    @staticmethod
    def _pop_response(session: SessionState) -> dict[str, object] | None:
        return session.responses.popleft() if session.responses else None
