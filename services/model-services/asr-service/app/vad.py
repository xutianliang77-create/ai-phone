from dataclasses import dataclass
from hashlib import sha256
import logging
from pathlib import Path
from typing import Protocol

from app.marblenet_runtime import MarbleNetOnnxRuntime
from app.vad_metrics import VadMetricsStore


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class VadDecision:
    voiced: bool
    probability: float | None
    provider: str


class VadProvider(Protocol):
    @property
    def name(self) -> str:
        ...

    def analyze(
        self,
        session_id: str,
        pcm: bytes,
        sample_rate: int,
        threshold: float | None = None,
    ) -> VadDecision:
        ...

    def reset_session(self, session_id: str) -> None:
        ...

    def close_session(self, session_id: str) -> None:
        ...

    def diagnostics(self, session_id: str) -> dict[str, object]:
        ...

    def health_diagnostics(self) -> dict[str, object]:
        ...


class RmsVadProvider:
    def __init__(
        self,
        energy_threshold: int,
        configured_provider: str = "rms",
        active_provider: str = "rms",
        threshold: float = 0.0,
        fallback_reason: str | None = None,
        model_fingerprint: str | None = None,
    ) -> None:
        self.energy_threshold = energy_threshold
        self.configured_provider = configured_provider
        self.active_provider = active_provider
        self.threshold = threshold
        self.fallback_reason = fallback_reason
        self.model_fingerprint = model_fingerprint
        self.metrics = VadMetricsStore()

    @property
    def name(self) -> str:
        return self.active_provider

    def analyze(
        self,
        session_id: str,
        pcm: bytes,
        sample_rate: int,
        threshold: float | None = None,
    ) -> VadDecision:
        del sample_rate, threshold
        from app.audio_buffer import pcm16_rms

        voiced = pcm16_rms(pcm) > self.energy_threshold
        self.metrics.record(session_id, voiced, None)
        return VadDecision(
            voiced=voiced,
            probability=None,
            provider=self.active_provider,
        )

    def reset_session(self, session_id: str) -> None:
        del session_id

    def close_session(self, session_id: str) -> None:
        self.metrics.clear(session_id)

    def diagnostics(self, session_id: str) -> dict[str, object]:
        return {
            **self.health_diagnostics(),
            **self.metrics.snapshot(session_id),
            "fallbackCount": int(self.fallback_reason is not None),
        }

    def health_diagnostics(self) -> dict[str, object]:
        return {
            "configuredProvider": self.configured_provider,
            "activeProvider": self.active_provider,
            "threshold": self.threshold,
            **({"fallbackReason": self.fallback_reason} if self.fallback_reason else {}),
            **(
                {"modelFingerprint": self.model_fingerprint}
                if self.model_fingerprint else {}
            ),
        }


class MarbleNetVadProvider:
    def __init__(
        self,
        runtime: MarbleNetOnnxRuntime,
        threshold: float,
        window_ms: int,
        smoothing_frames: int,
        fallback: VadProvider,
        model_fingerprint: str = "",
    ) -> None:
        self.runtime = runtime
        self.threshold = threshold
        self.window_ms = window_ms
        self.smoothing_frames = smoothing_frames
        self.fallback = fallback
        self.model_fingerprint = model_fingerprint
        self._audio_by_session: dict[str, tuple[int, bytes]] = {}
        self._failed = False
        self._fallback_reason: str | None = None
        self._fallback_sessions: set[str] = set()
        self._threshold_by_session: dict[str, float] = {}
        self.metrics = VadMetricsStore()

    @property
    def name(self) -> str:
        return "rms_fallback" if self._failed else "marblenet"

    def analyze(
        self,
        session_id: str,
        pcm: bytes,
        sample_rate: int,
        threshold: float | None = None,
    ) -> VadDecision:
        effective_threshold = self.threshold if threshold is None else threshold
        if not 0 <= effective_threshold <= 1:
            raise ValueError("VAD threshold must be between 0 and 1")
        self._threshold_by_session[session_id] = effective_threshold
        if self._failed:
            self._fallback_sessions.add(session_id)
            decision = self._fallback(
                session_id,
                pcm,
                sample_rate,
                effective_threshold,
            )
            self.metrics.record(session_id, decision.voiced, None)
            return decision

        previous_rate, previous = self._audio_by_session.get(
            session_id,
            (sample_rate, b""),
        )
        if previous_rate != sample_rate:
            previous = b""
        audio = previous + pcm
        max_bytes = sample_rate * 2 * self.window_ms // 1000
        audio = audio[-max_bytes:]
        self._audio_by_session[session_id] = (sample_rate, audio)
        duration_ms = len(pcm) * 1000 // (sample_rate * 2)
        try:
            probability = self.runtime.speech_probability(
                audio,
                sample_rate,
                duration_ms,
                self.smoothing_frames,
            )
        except Exception:
            logger.exception("MarbleNet VAD failed; switching to RMS fallback")
            self._failed = True
            self._fallback_reason = "runtime_failed"
            self._fallback_sessions.add(session_id)
            self._audio_by_session.clear()
            decision = self._fallback(
                session_id,
                pcm,
                sample_rate,
                effective_threshold,
            )
            self.metrics.record(session_id, decision.voiced, None)
            return decision
        decision = VadDecision(
            voiced=probability >= effective_threshold,
            probability=probability,
            provider="marblenet",
        )
        self.metrics.record(session_id, decision.voiced, probability)
        return decision

    def reset_session(self, session_id: str) -> None:
        self._audio_by_session.pop(session_id, None)
        self.fallback.reset_session(session_id)

    def close_session(self, session_id: str) -> None:
        self._audio_by_session.pop(session_id, None)
        self.metrics.clear(session_id)
        self._fallback_sessions.discard(session_id)
        self._threshold_by_session.pop(session_id, None)
        self.fallback.close_session(session_id)

    def diagnostics(self, session_id: str) -> dict[str, object]:
        return {
            **self.health_diagnostics(),
            "threshold": self._threshold_by_session.get(session_id, self.threshold),
            **self.metrics.snapshot(session_id),
            "fallbackCount": int(session_id in self._fallback_sessions),
        }

    def health_diagnostics(self) -> dict[str, object]:
        return {
            "configuredProvider": "marblenet",
            "activeProvider": self.name,
            "threshold": self.threshold,
            **(
                {"modelFingerprint": self.model_fingerprint}
                if self.model_fingerprint else {}
            ),
            **(
                {"fallbackReason": self._fallback_reason}
                if self._fallback_reason else {}
            ),
        }

    def _fallback(
        self,
        session_id: str,
        pcm: bytes,
        sample_rate: int,
        threshold: float,
    ) -> VadDecision:
        decision = self.fallback.analyze(
            session_id,
            pcm,
            sample_rate,
            threshold=threshold,
        )
        return VadDecision(
            voiced=decision.voiced,
            probability=decision.probability,
            provider="rms_fallback",
        )


def create_vad_provider(
    provider: str,
    model_path: str,
    assets_path: str,
    threshold: float,
    window_ms: int,
    smoothing_frames: int,
    fallback_energy_threshold: int,
) -> VadProvider:
    fallback = RmsVadProvider(fallback_energy_threshold)
    if provider == "rms":
        return fallback
    if provider != "marblenet":
        raise ValueError(f"Unsupported VAD provider: {provider}")
    if not Path(model_path).is_file() or not Path(assets_path).is_file():
        logger.error("MarbleNet assets are missing; using RMS fallback")
        return RmsVadProvider(
            fallback_energy_threshold,
            configured_provider="marblenet",
            active_provider="rms_fallback",
            threshold=threshold,
            fallback_reason="assets_missing",
        )
    model_fingerprint = file_fingerprint(model_path)
    try:
        runtime = MarbleNetOnnxRuntime(model_path, assets_path)
    except Exception:
        logger.exception("MarbleNet VAD failed to load; using RMS fallback")
        return RmsVadProvider(
            fallback_energy_threshold,
            configured_provider="marblenet",
            active_provider="rms_fallback",
            threshold=threshold,
            fallback_reason="load_failed",
            model_fingerprint=model_fingerprint,
        )
    return MarbleNetVadProvider(
        runtime=runtime,
        threshold=threshold,
        window_ms=window_ms,
        smoothing_frames=smoothing_frames,
        fallback=fallback,
        model_fingerprint=model_fingerprint,
    )


def file_fingerprint(path: str) -> str:
    digest = sha256()
    with Path(path).open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()
