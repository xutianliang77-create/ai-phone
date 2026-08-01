from __future__ import annotations

import threading

import numpy as np

from candidate_service.audio import (
    decode_request_audio,
    to_16khz_float,
)
from candidate_service.diagnostic_capture import DiagnosticCapture
from candidate_service.models import MossRunner, QwenRunner
from candidate_service.revision import RevisionWorker
from candidate_service.runtime_finalize import CandidateFinalizeMixin
from candidate_service.runtime_ingest import CandidateIngestMixin
from candidate_service.state import (
    CandidateConfig,
    SessionState,
    endpoint_policy,
)
from candidate_service.vad import RmsVadProvider

_BOUNDARY_MINIMUM_AUDIO_MS = 160
_BOUNDARY_MINIMUM_TAIL_MS = 80


class CandidateEngine(CandidateIngestMixin, CandidateFinalizeMixin):
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
