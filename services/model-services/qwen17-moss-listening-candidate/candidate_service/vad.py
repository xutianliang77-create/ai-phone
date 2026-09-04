from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from candidate_service.marblenet_onnx import (
    MarbleNetOnnxRuntime,
    file_fingerprint,
)


@dataclass(frozen=True)
class VadDecision:
    voiced: bool
    probability: float | None
    provider: str


@dataclass
class _VadStats:
    analyzed: int = 0
    speech: int = 0
    probability_total: float = 0
    probability_count: int = 0
    probability_min: float | None = None
    probability_max: float | None = None
    rms_total: float = 0
    rms_count: int = 0
    rms_min: float | None = None
    rms_max: float | None = None


class RmsVadProvider:
    def __init__(self, threshold: float) -> None:
        self.threshold = threshold
        self._stats: dict[str, _VadStats] = {}

    def analyze(
        self,
        session_id: str,
        pcm: np.ndarray,
        sample_rate: int,
    ) -> VadDecision:
        del sample_rate
        rms = (
            float(np.sqrt(np.mean(np.square(pcm.astype(np.float64)))))
            if len(pcm)
            else 0
        )
        decision = VadDecision(rms >= self.threshold, None, "rms")
        self._record(session_id, decision, rms)
        return decision

    def diagnostics(self, session_id: str) -> dict[str, object]:
        return {
            "configuredProvider": "rms",
            "activeProvider": "rms",
            "threshold": self.threshold,
            **_stats_snapshot(self._stats.get(session_id)),
            "fallbackCount": 0,
        }

    def health_diagnostics(self) -> dict[str, object]:
        return {
            "configuredProvider": "rms",
            "activeProvider": "rms",
            "threshold": self.threshold,
        }

    def close_session(self, session_id: str) -> None:
        self._stats.pop(session_id, None)

    def _record(
        self,
        session_id: str,
        decision: VadDecision,
        rms: float,
    ) -> None:
        _record(
            self._stats.setdefault(session_id, _VadStats()),
            decision,
            rms,
        )


class MarbleNetVadProvider:
    def __init__(
        self,
        runtime: MarbleNetOnnxRuntime,
        *,
        threshold: float,
        window_ms: int,
        smoothing_frames: int,
        fallback: RmsVadProvider,
        model_fingerprint: str,
    ) -> None:
        self.runtime = runtime
        self.threshold = threshold
        self.window_ms = window_ms
        self.smoothing_frames = smoothing_frames
        self.fallback = fallback
        self.model_fingerprint = model_fingerprint
        self._audio_by_session: dict[str, tuple[int, bytes]] = {}
        self._stats: dict[str, _VadStats] = {}
        self._fallback_sessions: set[str] = set()
        self._failed = False

    def analyze(
        self,
        session_id: str,
        pcm: np.ndarray,
        sample_rate: int,
    ) -> VadDecision:
        if self._failed:
            return self._fallback(session_id, pcm, sample_rate)
        raw = pcm.astype("<i2", copy=False).tobytes()
        previous_rate, previous = self._audio_by_session.get(
            session_id,
            (sample_rate, b""),
        )
        if previous_rate != sample_rate:
            previous = b""
        audio = (previous + raw)[-sample_rate * 2 * self.window_ms // 1000 :]
        self._audio_by_session[session_id] = (sample_rate, audio)
        duration_ms = len(raw) * 1000 // (sample_rate * 2)
        try:
            probability = self.runtime.speech_probability(
                audio,
                sample_rate,
                duration_ms,
                self.smoothing_frames,
            )
        except Exception:
            self._failed = True
            self._audio_by_session.clear()
            return self._fallback(session_id, pcm, sample_rate)
        decision = VadDecision(
            probability >= self.threshold,
            probability,
            "marblenet",
        )
        _record(
            self._stats.setdefault(session_id, _VadStats()),
            decision,
            _pcm16_rms(pcm),
        )
        return decision

    def diagnostics(self, session_id: str) -> dict[str, object]:
        return {
            **self.health_diagnostics(),
            **_stats_snapshot(self._stats.get(session_id)),
            "fallbackCount": int(session_id in self._fallback_sessions),
        }

    def health_diagnostics(self) -> dict[str, object]:
        return {
            "configuredProvider": "marblenet",
            "activeProvider": "rms_fallback" if self._failed else "marblenet",
            "threshold": self.threshold,
            "modelFingerprint": self.model_fingerprint,
            **({"fallbackReason": "runtime_failed"} if self._failed else {}),
        }

    def close_session(self, session_id: str) -> None:
        self._audio_by_session.pop(session_id, None)
        self._stats.pop(session_id, None)
        self._fallback_sessions.discard(session_id)
        self.fallback.close_session(session_id)

    def _fallback(
        self,
        session_id: str,
        pcm: np.ndarray,
        sample_rate: int,
    ) -> VadDecision:
        self._fallback_sessions.add(session_id)
        fallback = self.fallback.analyze(session_id, pcm, sample_rate)
        decision = VadDecision(
            fallback.voiced,
            fallback.probability,
            "rms_fallback",
        )
        _record(
            self._stats.setdefault(session_id, _VadStats()),
            decision,
            _pcm16_rms(pcm),
        )
        return decision


def create_marblenet_vad(
    *,
    model_path: str,
    assets_path: str,
    threshold: float,
    window_ms: int,
    smoothing_frames: int,
    fallback_rms_threshold: float,
) -> MarbleNetVadProvider:
    for path in (model_path, assets_path):
        if not Path(path).is_file():
            raise RuntimeError(f"MarbleNet VAD asset is missing: {path}")
    return MarbleNetVadProvider(
        MarbleNetOnnxRuntime(model_path, assets_path),
        threshold=threshold,
        window_ms=window_ms,
        smoothing_frames=smoothing_frames,
        fallback=RmsVadProvider(fallback_rms_threshold),
        model_fingerprint=file_fingerprint(model_path),
    )


def _record(
    stats: _VadStats,
    decision: VadDecision,
    rms: float,
) -> None:
    stats.analyzed += 1
    stats.speech += int(decision.voiced)
    stats.rms_total += rms
    stats.rms_count += 1
    stats.rms_min = rms if stats.rms_min is None else min(stats.rms_min, rms)
    stats.rms_max = rms if stats.rms_max is None else max(stats.rms_max, rms)
    if decision.probability is None:
        return
    probability = decision.probability
    stats.probability_total += probability
    stats.probability_count += 1
    stats.probability_min = (
        probability
        if stats.probability_min is None
        else min(stats.probability_min, probability)
    )
    stats.probability_max = (
        probability
        if stats.probability_max is None
        else max(stats.probability_max, probability)
    )


def _stats_snapshot(stats: _VadStats | None) -> dict[str, object]:
    current = stats or _VadStats()
    result: dict[str, object] = {
        "analyzedFrameCount": current.analyzed,
        "speechFrameCount": current.speech,
        "speechFrameRatio": (
            current.speech / current.analyzed if current.analyzed else 0
        ),
    }
    if current.probability_count:
        result.update(
            probabilityMin=current.probability_min,
            probabilityMax=current.probability_max,
            probabilityMean=(
                current.probability_total / current.probability_count
            ),
        )
    if current.rms_count:
        result.update(
            rmsMin=current.rms_min,
            rmsMax=current.rms_max,
            rmsMean=current.rms_total / current.rms_count,
        )
    return result


def _pcm16_rms(pcm: np.ndarray) -> float:
    return (
        float(np.sqrt(np.mean(np.square(pcm.astype(np.float64)))))
        if len(pcm)
        else 0
    )
