from dataclasses import dataclass
import logging
from pathlib import Path
from typing import Protocol

import numpy as np


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
    ) -> VadDecision:
        ...

    def reset_session(self, session_id: str) -> None:
        ...


class RmsVadProvider:
    def __init__(self, energy_threshold: int) -> None:
        self.energy_threshold = energy_threshold

    @property
    def name(self) -> str:
        return "rms"

    def analyze(
        self,
        session_id: str,
        pcm: bytes,
        sample_rate: int,
    ) -> VadDecision:
        del session_id, sample_rate
        from app.audio_buffer import pcm16_rms

        return VadDecision(
            voiced=pcm16_rms(pcm) > self.energy_threshold,
            probability=None,
            provider="rms",
        )

    def reset_session(self, session_id: str) -> None:
        del session_id


class MarbleNetOnnxRuntime:
    def __init__(self, model_path: str, assets_path: str) -> None:
        import onnxruntime as ort
        import torch

        self._torch = torch
        with np.load(assets_path) as assets:
            self._window = torch.from_numpy(assets["window"]).float()
            self._filterbank = torch.from_numpy(assets["filterbank"]).float()
            self._n_fft = int(assets["n_fft"])
            self._hop_length = int(assets["hop_length"])
            self._win_length = int(assets["win_length"])
            self._preemph = float(assets["preemph"])
            self._log_guard = float(assets["log_guard"])
            self._pad_to = int(assets["pad_to"])
        self._session = ort.InferenceSession(
            model_path,
            providers=["CPUExecutionProvider"],
        )

    def speech_probability(
        self,
        pcm: bytes,
        sample_rate: int,
        current_duration_ms: int,
        smoothing_frames: int,
    ) -> float:
        samples = pcm16_float_samples(pcm, sample_rate, 16_000)
        if len(samples) < self._n_fft:
            return 0.0

        features, valid_feature_frames = self._features(samples)
        logits = self._session.run(
            None,
            {"audio_signal": features.numpy()},
        )[0]
        probabilities = softmax(logits[0], axis=-1)[:, 1]
        valid_output_frames = max(1, (valid_feature_frames + 1) // 2)
        probabilities = probabilities[:valid_output_frames]
        current_frames = max(1, round(current_duration_ms / 20))
        tail = probabilities[-current_frames:]
        if not len(tail):
            return 0.0
        window_size = min(len(tail), max(1, smoothing_frames))
        smoothed = [
            float(np.median(tail[index:index + window_size]))
            for index in range(len(tail) - window_size + 1)
        ]
        return max(smoothed)

    def _features(self, samples: np.ndarray):
        torch = self._torch
        signal = torch.from_numpy(samples).unsqueeze(0)
        length = signal.shape[1]
        signal = torch.cat(
            (
                signal[:, :1],
                signal[:, 1:] - self._preemph * signal[:, :-1],
            ),
            dim=1,
        )
        spectrum = torch.stft(
            signal,
            n_fft=self._n_fft,
            hop_length=self._hop_length,
            win_length=self._win_length,
            center=True,
            window=self._window,
            return_complex=True,
            pad_mode="constant",
        ).abs().pow(2)
        features = torch.matmul(self._filterbank, spectrum)
        features = torch.log(features + self._log_guard)

        valid_frames = length // self._hop_length
        if features.shape[-1] > valid_frames:
            features[:, :, valid_frames:] = 0.0
        remainder = features.shape[-1] % self._pad_to
        if remainder:
            features = torch.nn.functional.pad(
                features,
                (0, self._pad_to - remainder),
            )
        return features.float(), valid_frames


class MarbleNetVadProvider:
    def __init__(
        self,
        runtime: MarbleNetOnnxRuntime,
        threshold: float,
        window_ms: int,
        smoothing_frames: int,
        fallback: VadProvider,
    ) -> None:
        self.runtime = runtime
        self.threshold = threshold
        self.window_ms = window_ms
        self.smoothing_frames = smoothing_frames
        self.fallback = fallback
        self._audio_by_session: dict[str, tuple[int, bytes]] = {}
        self._failed = False

    @property
    def name(self) -> str:
        return "rms_fallback" if self._failed else "marblenet"

    def analyze(
        self,
        session_id: str,
        pcm: bytes,
        sample_rate: int,
    ) -> VadDecision:
        if self._failed:
            return self._fallback(session_id, pcm, sample_rate)

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
            self._audio_by_session.clear()
            return self._fallback(session_id, pcm, sample_rate)
        return VadDecision(
            voiced=probability >= self.threshold,
            probability=probability,
            provider="marblenet",
        )

    def reset_session(self, session_id: str) -> None:
        self._audio_by_session.pop(session_id, None)
        self.fallback.reset_session(session_id)

    def _fallback(
        self,
        session_id: str,
        pcm: bytes,
        sample_rate: int,
    ) -> VadDecision:
        decision = self.fallback.analyze(session_id, pcm, sample_rate)
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
        return fallback
    try:
        runtime = MarbleNetOnnxRuntime(model_path, assets_path)
    except Exception:
        logger.exception("MarbleNet VAD failed to load; using RMS fallback")
        return fallback
    return MarbleNetVadProvider(
        runtime=runtime,
        threshold=threshold,
        window_ms=window_ms,
        smoothing_frames=smoothing_frames,
        fallback=fallback,
    )


def pcm16_float_samples(
    pcm: bytes,
    source_rate: int,
    target_rate: int,
) -> np.ndarray:
    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
    if not len(samples) or source_rate == target_rate:
        return samples
    output_length = max(1, round(len(samples) * target_rate / source_rate))
    source_positions = np.arange(len(samples), dtype=np.float32)
    target_positions = np.linspace(
        0,
        len(samples) - 1,
        output_length,
        dtype=np.float32,
    )
    return np.interp(target_positions, source_positions, samples).astype(np.float32)


def softmax(values: np.ndarray, axis: int) -> np.ndarray:
    shifted = values - np.max(values, axis=axis, keepdims=True)
    exponent = np.exp(shifted)
    return exponent / np.sum(exponent, axis=axis, keepdims=True)
