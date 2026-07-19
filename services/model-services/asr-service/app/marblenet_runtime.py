import numpy as np


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
