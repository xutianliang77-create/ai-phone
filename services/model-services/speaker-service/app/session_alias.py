import asyncio
import base64
from dataclasses import dataclass, field
import io
from pathlib import Path
import tempfile
from typing import Protocol
import wave


class SpeakerEmbedder(Protocol):
    def embedding(self, audio_base64: str): ...


class NoUsableSpeechWindow(ValueError):
    pass


@dataclass
class SessionAliasObservation:
    rawSpeakerId: str
    evidenceMs: int
    eligible: bool
    similarities: dict[str, float]


@dataclass
class _Profile:
    vector: object
    evidence_ms: int


@dataclass
class _Session:
    profiles: dict[str, _Profile] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


@dataclass(frozen=True)
class QualityWindow:
    start_sample: int
    end_sample: int
    score: float


class SessionSpeakerEmbeddingEngine:
    available = True

    def __init__(
        self,
        embedder: SpeakerEmbedder,
        minimum_evidence_ms: int = 1500,
    ) -> None:
        self._embedder = embedder
        self._minimum_evidence_ms = minimum_evidence_ms
        self._sessions: dict[str, _Session] = {}

    async def create_session(self, session_id: str) -> None:
        self._sessions[session_id] = _Session()

    async def observe(
        self,
        session_id: str,
        raw_speaker_id: str,
        audio_base64: str,
        overlap: bool,
    ) -> SessionAliasObservation:
        session = self._session(session_id)
        evidence_ms = wav_duration_ms(audio_base64)
        if overlap or evidence_ms < self._minimum_evidence_ms:
            return SessionAliasObservation(
                rawSpeakerId=raw_speaker_id,
                evidenceMs=evidence_ms,
                eligible=False,
                similarities={},
            )

        async with session.lock:
            try:
                vector = await asyncio.to_thread(
                    self._embedder.embedding,
                    audio_base64,
                )
            except NoUsableSpeechWindow:
                return SessionAliasObservation(
                    rawSpeakerId=raw_speaker_id,
                    evidenceMs=evidence_ms,
                    eligible=False,
                    similarities={},
                )
            vector = normalized(vector)
            current_profile = update_profile(
                session.profiles.get(raw_speaker_id),
                vector,
                evidence_ms,
            )
            session.profiles[raw_speaker_id] = current_profile
            similarities = {
                speaker_id: cosine(current_profile.vector, profile.vector)
                for speaker_id, profile in session.profiles.items()
                if speaker_id != raw_speaker_id
            }
        return SessionAliasObservation(
            rawSpeakerId=raw_speaker_id,
            evidenceMs=evidence_ms,
            eligible=True,
            similarities=similarities,
        )

    async def close_session(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def _session(self, session_id: str) -> _Session:
        session = self._sessions.get(session_id)
        if session is None:
            raise KeyError("speaker alias session not found")
        return session


class DisabledSessionSpeakerEmbeddingEngine:
    available = False

    async def create_session(self, _: str) -> None:
        return None

    async def observe(
        self,
        session_id: str,
        raw_speaker_id: str,
        audio_base64: str,
        overlap: bool,
    ) -> SessionAliasObservation:
        raise RuntimeError("session speaker alias provider is not configured")

    async def close_session(self, _: str) -> None:
        return None


class NemoSpeakerEmbedder:
    def __init__(self, model_id: str) -> None:
        self._model_id = model_id
        self._model = None

    def load(self) -> None:
        self._load_model()

    def embedding(self, audio_base64: str):
        whole, windows = self.embedding_components(audio_base64)
        return fuse_profile_vectors(whole, windows)

    def embedding_components(self, audio_base64: str):
        audio = base64.b64decode(audio_base64, validate=True)
        samples, sample_rate = read_pcm16_wav(audio)
        windows = select_quality_windows(samples, sample_rate)
        if not windows:
            raise NoUsableSpeechWindow(
                "session speaker alias evidence has no usable speech window",
            )
        whole = self._embedding_for_audio(audio)
        vectors = [
            self._embedding_for_audio(
                encode_pcm16_wav(
                    samples[window.start_sample:window.end_sample],
                    sample_rate,
                ),
            )
            for window in windows
        ]
        return whole, vectors

    def _embedding_for_audio(self, audio: bytes):
        import torch

        with tempfile.NamedTemporaryFile(suffix=".wav") as handle:
            handle.write(audio)
            handle.flush()
            with torch.no_grad():
                embedding = self._load_model().get_embedding(handle.name)
        return normalized(embedding.detach().cpu().numpy().reshape(-1))

    def _load_model(self):
        if self._model is not None:
            return self._model
        checkpoint = Path(self._model_id)
        if not checkpoint.is_file():
            raise FileNotFoundError(
                f"Session speaker alias checkpoint is missing: {self._model_id}",
            )
        from nemo.collections.asr.models import EncDecSpeakerLabelModel

        self._model = EncDecSpeakerLabelModel.restore_from(str(checkpoint))
        self._model.eval()
        return self._model


def wav_duration_ms(audio_base64: str) -> int:
    audio = base64.b64decode(audio_base64, validate=True)
    validate_wav(audio)
    with wave.open(io.BytesIO(audio), "rb") as handle:
        return round(handle.getnframes() / handle.getframerate() * 1000)


def validate_wav(audio: bytes) -> None:
    read_pcm16_wav(audio)


def read_pcm16_wav(audio: bytes):
    import numpy as np

    try:
        with wave.open(io.BytesIO(audio), "rb") as handle:
            if handle.getnchannels() != 1 or handle.getsampwidth() != 2:
                raise ValueError("session speaker alias audio must be mono PCM16 WAV")
            if handle.getframerate() not in (16000, 24000):
                raise ValueError(
                    "session speaker alias audio must use 16kHz or 24kHz",
                )
            sample_rate = handle.getframerate()
            samples = np.frombuffer(
                handle.readframes(handle.getnframes()),
                dtype="<i2",
            ).copy()
    except (EOFError, wave.Error) as exc:
        raise ValueError("session speaker alias audio must be WAV") from exc
    return samples, sample_rate


def encode_pcm16_wav(samples, sample_rate: int) -> bytes:
    import numpy as np

    output = io.BytesIO()
    with wave.open(output, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(np.asarray(samples, dtype="<i2").tobytes())
    return output.getvalue()


def select_quality_windows(
    samples,
    sample_rate: int,
    window_ms: int = 1500,
    shift_ms: int = 750,
    max_windows: int = 3,
) -> list[QualityWindow]:
    window_samples = min(
        len(samples),
        max(1, round(sample_rate * window_ms / 1000)),
    )
    shift_samples = max(1, round(sample_rate * shift_ms / 1000))
    last_start = max(0, len(samples) - window_samples)
    starts = list(range(0, last_start + 1, shift_samples)) or [0]
    if starts[-1] != last_start:
        starts.append(last_start)
    candidates = []
    for start in starts:
        end = start + window_samples
        eligible, score = window_quality(samples[start:end], sample_rate)
        if eligible:
            candidates.append(QualityWindow(start, end, score))
    return sorted(candidates, key=lambda item: item.score, reverse=True)[
        :max_windows
    ]


def window_quality(samples, sample_rate: int) -> tuple[bool, float]:
    import numpy as np

    signal = np.asarray(samples, dtype=np.float32) / 32768.0
    if signal.size == 0:
        return False, float("-inf")
    frame_samples = max(1, round(sample_rate * 0.02))
    usable = signal.size // frame_samples * frame_samples
    if usable == 0:
        return False, float("-inf")
    frames = signal[:usable].reshape(-1, frame_samples)
    frame_rms = np.sqrt(np.mean(np.square(frames), axis=1) + 1e-12)
    peak_frame_rms = float(np.max(frame_rms))
    active_floor = max(10 ** (-60 / 20), peak_frame_rms * 10 ** (-25 / 20))
    active_ratio = float(np.mean(frame_rms >= active_floor))
    rms = float(np.sqrt(np.mean(np.square(signal)) + 1e-12))
    clipping_ratio = float(np.mean(np.abs(signal) >= 0.995))
    score = (
        20 * float(np.log10(max(rms, 1e-8)))
        + 8 * active_ratio
        - 40 * clipping_ratio
    )
    eligible = rms >= 10 ** (-60 / 20) and active_ratio >= 0.1
    return eligible and clipping_ratio <= 0.02, score


def robust_profile_vector(vectors):
    import numpy as np

    normalized_vectors = np.stack([normalized(vector) for vector in vectors])
    if len(normalized_vectors) >= 3:
        similarity = normalized_vectors @ normalized_vectors.T
        consistency = (
            np.sum(similarity, axis=1) - 1
        ) / (len(normalized_vectors) - 1)
        normalized_vectors = np.delete(
            normalized_vectors,
            int(np.argmin(consistency)),
            axis=0,
        )
    return normalized(np.mean(normalized_vectors, axis=0))


def fuse_profile_vectors(anchor, windows, window_weight: float = 0.02):
    window_profile = robust_profile_vector(windows)
    return normalized(
        normalized(anchor) * (1 - window_weight)
        + window_profile * window_weight,
    )


def normalized(vector):
    import numpy as np

    value = np.asarray(vector, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(value))
    if norm <= 0:
        raise ValueError("empty session speaker embedding")
    return value / norm


def cosine(left, right) -> float:
    import numpy as np

    return max(-1.0, min(1.0, float(np.dot(left, right))))


def update_profile(
    profile: _Profile | None,
    vector,
    evidence_ms: int,
) -> _Profile:
    if profile is None:
        return _Profile(vector=vector, evidence_ms=evidence_ms)
    total = profile.evidence_ms + evidence_ms
    combined = (
        profile.vector * profile.evidence_ms + vector * evidence_ms
    ) / total
    return _Profile(vector=normalized(combined), evidence_ms=total)
