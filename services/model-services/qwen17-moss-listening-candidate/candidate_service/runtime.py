from __future__ import annotations

import logging
import threading
from time import perf_counter

import numpy as np

from candidate_service.audio import (
    confirmed_readable_prefix,
    decode_request_audio,
    language_code,
    to_16khz_float,
)
from candidate_service.diagnostic_capture import DiagnosticCapture
from candidate_service.models import MossRunner, QwenRunner
from candidate_service.policy import (
    has_adjacent_duplicate,
    is_low_evidence_silence_hallucination,
)
from candidate_service.revision import RevisionResult, RevisionWorker
from candidate_service.state import (
    CandidateConfig,
    SessionState,
    Utterance,
    endpoint_policy,
)
from candidate_service.vad import RmsVadProvider

logger = logging.getLogger(__name__)

_BOUNDARY_MINIMUM_AUDIO_MS = 160
_BOUNDARY_MINIMUM_TAIL_MS = 80


class CandidateEngine:
    def __init__(
        self,
        qwen: QwenRunner,
        moss: MossRunner,
        config: CandidateConfig | None = None,
        vad=None,
        diagnostic_capture: DiagnosticCapture | None = None,
    ) -> None:
        self.qwen = qwen
        self.config = config or CandidateConfig()
        self.vad = vad or RmsVadProvider(self.config.vad_rms_threshold)
        self.diagnostic_capture = diagnostic_capture or DiagnosticCapture()
        self._sessions: dict[str, SessionState] = {}
        self._state_lock = threading.RLock()
        self._gpu_lock = threading.Lock()
        self._revision_worker = RevisionWorker(moss, self._gpu_lock)
        self._metrics: dict[str, int | float | None] = {
            "frames": 0,
            "speechFrames": 0,
            "partials": 0,
            "finals": 0,
            "batchFinals": 0,
            "batchFinalFallbacks": 0,
            "boundarySplitHits": 0,
            "boundarySplitFallbacks": 0,
            "silenceHallucinationsSuppressed": 0,
            "lastBatchFinalLatencyMs": None,
            "revisionCandidates": 0,
            "revisionsApplied": 0,
            "revisionFallbacks": 0,
            "revisionErrors": 0,
            "lastRevisionLatencyMs": None,
        }

    def process_frame(self, request: dict[str, object]) -> dict[str, object] | None:
        pcm, sample_rate = decode_request_audio(request)
        audio = to_16khz_float(pcm, sample_rate)
        duration_ms = len(audio) / 16
        session_id = str(request["sessionId"])
        with self._state_lock:
            self.diagnostic_capture.append(session_id, pcm, sample_rate)
            vad_decision = self.vad.analyze(session_id, pcm, sample_rate)
            session = self._sessions.setdefault(
                session_id,
                SessionState(session_id=session_id),
            )
            sequence = int(request["sequence"])
            if sequence <= session.last_sequence:
                return self._pop_response(session)
            session.last_sequence = sequence
            session.source_language = str(request.get("sourceLanguage") or "auto")
            self._metrics["frames"] = int(self._metrics["frames"] or 0) + 1
            session.analyzed_frames += 1
            self._ingest(
                session,
                audio,
                duration_ms,
                vad_decision.voiced,
                vad_decision.probability,
                int(request.get("timestampMs") or 0),
            )
            return self._pop_response(session)

    def flush(
        self,
        session_id: str,
        source_language: str,
    ) -> dict[str, object] | None:
        with self._state_lock:
            session = self._sessions.setdefault(
                session_id,
                SessionState(session_id=session_id),
            )
            session.source_language = source_language
            if session.utterance is not None:
                self._finalize(session, "flush")
            return self._pop_response(session)

    def commit_boundary(
        self,
        session_id: str,
        source_language: str,
        boundary_ms: int,
    ) -> dict[str, object] | None:
        with self._state_lock:
            session = self._sessions.setdefault(
                session_id,
                SessionState(session_id=session_id),
            )
            session.source_language = source_language
            utterance = session.utterance
            if utterance is None or not utterance.final_audio:
                self._record_boundary_fallback()
                return None

            audio = np.concatenate(utterance.final_audio)
            split_samples = round((boundary_ms - utterance.start_ms) * 16)
            minimum_samples = _BOUNDARY_MINIMUM_AUDIO_MS * 16
            if split_samples < minimum_samples or split_samples > len(audio):
                self._record_boundary_fallback()
                return None

            previous_audio = audio[:split_samples]
            following_audio = audio[split_samples:]
            utterance.audio = [previous_audio]
            utterance.final_audio = [previous_audio]
            utterance.samples = len(previous_audio)
            response = self._finalize(
                session,
                "speaker_boundary",
                allow_streaming_fallback=False,
            )
            if response is None:
                self._record_boundary_fallback()
            else:
                self._metrics["boundarySplitHits"] = (
                    int(self._metrics["boundarySplitHits"] or 0) + 1
                )
                try:
                    session.responses.remove(response)
                except ValueError:
                    pass

            if len(following_audio) >= _BOUNDARY_MINIMUM_TAIL_MS * 16:
                self._start_retained_utterance(
                    session,
                    following_audio,
                    boundary_ms,
                    utterance.max_speech_probability,
                )
            return response

    def close_session(self, session_id: str) -> None:
        with self._state_lock:
            self._sessions.pop(session_id, None)
            self.vad.close_session(session_id)
            self.diagnostic_capture.close_session(session_id)

    def diagnostics(self, session_id: str) -> dict[str, object]:
        with self._state_lock:
            session = self._sessions.get(session_id)
            frames = session.analyzed_frames if session else 0
            speech = session.speech_frames if session else 0
            return {
                **self.vad.diagnostics(session_id),
                "endpointPolicy": endpoint_policy(self.config),
                "candidate": {
                    "frames": frames,
                    "speechFrames": speech,
                    "partials": session.partials if session else 0,
                    "finals": session.finals if session else 0,
                    "batchFinals": session.batch_finals if session else 0,
                    "batchFinalFallbacks": (
                        session.batch_final_fallbacks if session else 0
                    ),
                    "lastBatchFinalLatencyMs": (
                        session.last_batch_final_latency_ms if session else None
                    ),
                    "sessionActive": bool(session and session.utterance),
                    "queuedResponses": len(session.responses) if session else 0,
                },
            }

    def status(self) -> dict[str, object]:
        with self._state_lock:
            return {
                "strategy": "qwen17_stable_readable_plus_moss_duplicate_patch_v2",
                "policy": "moss_confirmed_surgical_duplicate_patch_v2",
                "mode": "listening",
                "vad": self.vad.health_diagnostics(),
                "diagnosticCapture": self.diagnostic_capture.diagnostics(),
                "metrics": dict(self._metrics),
                "activeSessions": len(self._sessions),
            }

    def shutdown(self) -> None:
        self.diagnostic_capture.shutdown()
        self._revision_worker.shutdown()

    def _ingest(
        self,
        session: SessionState,
        audio: np.ndarray,
        duration_ms: float,
        speech: bool,
        speech_probability: float | None,
        timestamp_ms: int,
    ) -> None:
        if speech:
            self._metrics["speechFrames"] = (
                int(self._metrics["speechFrames"] or 0) + 1
            )
            session.speech_frames += 1
        if session.utterance is None:
            self._append_prerolls(session, audio)
            if not speech:
                return
            with self._gpu_lock:
                qwen_state = self.qwen.new_state(session.source_language)
            utterance = Utterance(
                segment_id=f"qwen17_{session.next_segment}",
                qwen_state=qwen_state,
                start_ms=max(0, timestamp_ms - round(session.preroll_samples / 16)),
                voiced_ms=duration_ms,
                max_speech_probability=speech_probability,
            )
            session.next_segment += 1
            session.utterance = utterance
            buffered = (
                np.concatenate(list(session.preroll))
                if session.preroll
                else audio
            )
            revision_buffered = (
                np.concatenate(list(session.revision_preroll))
                if session.revision_preroll
                else buffered
            )
            utterance.audio.append(revision_buffered)
            utterance.final_audio.append(buffered)
            session.preroll.clear()
            session.preroll_samples = 0
            session.revision_preroll.clear()
            session.revision_preroll_samples = 0
            self._feed_qwen(session, utterance, buffered, record_audio=False)
            return

        utterance = session.utterance
        if speech:
            utterance.voiced_ms += duration_ms
            if speech_probability is not None:
                utterance.max_speech_probability = max(
                    utterance.max_speech_probability or 0,
                    speech_probability,
                )
        self._feed_qwen(session, utterance, audio)
        utterance.silence_ms = (
            utterance.silence_ms + duration_ms if not speech else 0
        )
        total_ms = utterance.samples / 16
        if total_ms >= self.config.max_audio_ms:
            self._finalize(session, "max_duration")
        elif utterance.silence_ms >= self.config.endpoint_silence_ms:
            self._finalize(session, "silence")

    def _append_prerolls(self, session: SessionState, audio: np.ndarray) -> None:
        session.preroll.append(audio)
        session.preroll_samples += len(audio)
        max_samples = self.config.preroll_ms * 16
        while session.preroll and session.preroll_samples > max_samples:
            session.preroll_samples -= len(session.preroll.popleft())
        session.revision_preroll.append(audio)
        session.revision_preroll_samples += len(audio)
        revision_max_samples = self.config.revision_preroll_ms * 16
        while (
            session.revision_preroll
            and session.revision_preroll_samples > revision_max_samples
        ):
            session.revision_preroll_samples -= len(
                session.revision_preroll.popleft()
            )

    def _feed_qwen(
        self,
        session: SessionState,
        utterance: Utterance,
        audio: np.ndarray,
        record_audio: bool = True,
    ) -> None:
        if record_audio:
            utterance.audio.append(audio)
            utterance.final_audio.append(audio)
        utterance.samples += len(audio)
        with self._gpu_lock:
            decode_id, text, _language = self.qwen.push(
                utterance.qwen_state,
                audio,
            )
        if decode_id <= 0 or not text or text == utterance.previous_decode:
            return
        confirmed = confirmed_readable_prefix(
            utterance.previous_decode,
            text,
            self.config.minimum_readable_units,
        )
        utterance.previous_decode = text
        if not confirmed or confirmed == utterance.last_partial:
            return
        if utterance.last_partial and not confirmed.startswith(
            utterance.last_partial
        ):
            return
        utterance.last_partial = confirmed
        session.responses.append(
            self._response(
                utterance,
                confirmed,
                self._state_language(utterance, session),
                None,
            )
        )
        self._metrics["partials"] = int(self._metrics["partials"] or 0) + 1
        session.partials += 1

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
            return "", str(getattr(utterance.qwen_state, "language", "") or "")
        with self._gpu_lock:
            return self.qwen.finish(utterance.qwen_state)

    def _start_retained_utterance(
        self,
        session: SessionState,
        audio: np.ndarray,
        start_ms: int,
        speech_probability: float | None,
    ) -> None:
        with self._gpu_lock:
            qwen_state = self.qwen.new_state(session.source_language)
        utterance = Utterance(
            segment_id=f"qwen17_{session.next_segment}",
            qwen_state=qwen_state,
            start_ms=start_ms,
            audio=[audio],
            final_audio=[audio],
            voiced_ms=len(audio) / 16,
            max_speech_probability=speech_probability,
        )
        session.next_segment += 1
        session.utterance = utterance
        self._feed_qwen(session, utterance, audio, record_audio=False)

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
                        language_code(model_language, current.source_language),
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

    def _state_language(
        self,
        utterance: Utterance,
        session: SessionState,
    ) -> str:
        model_language = str(getattr(utterance.qwen_state, "language", "") or "")
        return language_code(model_language, session.source_language)

    @staticmethod
    def _pop_response(session: SessionState) -> dict[str, object] | None:
        return session.responses.popleft() if session.responses else None
