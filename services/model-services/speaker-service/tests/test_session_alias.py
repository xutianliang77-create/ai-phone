import base64
import asyncio
import io
import wave

import numpy as np
import pytest

from app.session_alias import (
    NoUsableSpeechWindow,
    SessionSpeakerEmbeddingEngine,
    fuse_profile_vectors,
    robust_profile_vector,
    select_quality_windows,
)


class FakeEmbedder:
    def __init__(self, vectors: list[list[float]]) -> None:
        self.vectors = list(vectors)
        self.calls = 0

    def embedding(self, _: str):
        self.calls += 1
        return np.asarray(self.vectors.pop(0), dtype=np.float32)


class RejectingEmbedder:
    def embedding(self, _: str):
        raise NoUsableSpeechWindow()


def test_returns_similarity_without_persisting_across_sessions() -> None:
    asyncio.run(run_session_isolation_case())


async def run_session_isolation_case() -> None:
    embedder = FakeEmbedder([[1, 0], [0.8, 0.6], [1, 0]])
    engine = SessionSpeakerEmbeddingEngine(embedder, minimum_evidence_ms=1500)
    await engine.create_session("sess_1")

    first = await engine.observe(
        "sess_1", "speaker_1", wav_base64(1600), overlap=False,
    )
    second = await engine.observe(
        "sess_1", "speaker_2", wav_base64(1600), overlap=False,
    )
    await engine.close_session("sess_1")
    await engine.create_session("sess_2")
    other_session = await engine.observe(
        "sess_2", "speaker_2", wav_base64(1600), overlap=False,
    )

    assert first.similarities == {}
    assert second.similarities == {"speaker_1": pytest.approx(0.8)}
    assert second.evidenceMs == 1600
    assert other_session.similarities == {}


def test_rejects_short_and_overlap_evidence_before_embedding() -> None:
    asyncio.run(run_evidence_rejection_case())


async def run_evidence_rejection_case() -> None:
    embedder = FakeEmbedder([[1, 0]])
    engine = SessionSpeakerEmbeddingEngine(embedder, minimum_evidence_ms=1500)
    await engine.create_session("sess_1")

    short = await engine.observe(
        "sess_1", "speaker_1", wav_base64(1499), overlap=False,
    )
    overlap = await engine.observe(
        "sess_1", "speaker_1", wav_base64(1600), overlap=True,
    )

    assert short.similarities == {}
    assert short.eligible is False
    assert overlap.similarities == {}
    assert overlap.eligible is False
    assert embedder.calls == 0


def test_rejects_evidence_without_a_usable_speech_window() -> None:
    async def run_case() -> None:
        engine = SessionSpeakerEmbeddingEngine(
            RejectingEmbedder(),
            minimum_evidence_ms=1500,
        )
        await engine.create_session("sess_1")

        result = await engine.observe(
            "sess_1", "speaker_1", wav_base64(1600), overlap=False,
        )

        assert result.eligible is False
        assert result.similarities == {}

    asyncio.run(run_case())


def test_updates_a_raw_slot_profile_with_normalized_running_mean() -> None:
    asyncio.run(run_profile_update_case())


async def run_profile_update_case() -> None:
    embedder = FakeEmbedder([[1, 0], [0, 1], [1, 0]])
    engine = SessionSpeakerEmbeddingEngine(embedder, minimum_evidence_ms=1500)
    await engine.create_session("sess_1")

    await engine.observe("sess_1", "speaker_1", wav_base64(1600), False)
    await engine.observe("sess_1", "speaker_1", wav_base64(1600), False)
    result = await engine.observe(
        "sess_1", "speaker_2", wav_base64(1600), False,
    )

    assert result.similarities["speaker_1"] == pytest.approx(2 ** -0.5)


def test_compares_the_aggregated_current_slot_profile() -> None:
    asyncio.run(run_aggregated_current_profile_case())


async def run_aggregated_current_profile_case() -> None:
    embedder = FakeEmbedder([[1, 0], [0.5, 0.866], [0.8, -0.6]])
    engine = SessionSpeakerEmbeddingEngine(embedder, minimum_evidence_ms=1500)
    await engine.create_session("sess_1")

    await engine.observe("sess_1", "speaker_1", wav_base64(1600), False)
    await engine.observe("sess_1", "speaker_2", wav_base64(1600), False)
    result = await engine.observe(
        "sess_1", "speaker_2", wav_base64(1600), False,
    )

    assert result.similarities["speaker_1"] == pytest.approx(0.9797, abs=1e-4)


def test_selects_active_unclipped_windows() -> None:
    sample_rate = 16000
    silence = np.zeros(sample_rate * 3 // 2, dtype=np.int16)
    phase = np.arange(sample_rate * 3 // 2, dtype=np.float32)
    speech = (np.sin(phase * 2 * np.pi * 220 / sample_rate) * 5000).astype(
        np.int16,
    )
    clipped = np.full(sample_rate * 3 // 2, 32767, dtype=np.int16)
    samples = np.concatenate([silence, speech, clipped])

    windows = select_quality_windows(
        samples,
        sample_rate,
        window_ms=1500,
        shift_ms=750,
        max_windows=2,
    )

    assert windows[0].start_sample == sample_rate * 3 // 2
    assert all(window.start_sample < sample_rate * 3 for window in windows)
    assert select_quality_windows(silence, sample_rate) == []
    quiet_speech = (speech.astype(np.float32) * 0.025).astype(np.int16)
    assert select_quality_windows(quiet_speech, sample_rate)


def test_robust_profile_vector_discards_one_embedding_outlier() -> None:
    result = robust_profile_vector([
        np.asarray([1.0, 0.0], dtype=np.float32),
        np.asarray([0.98, 0.2], dtype=np.float32),
        np.asarray([-1.0, 0.0], dtype=np.float32),
    ])

    assert result[0] > 0.99
    assert 0 < result[1] < 0.2


def test_fuses_selected_windows_without_replacing_the_anchor() -> None:
    result = fuse_profile_vectors(
        np.asarray([1.0, 0.0], dtype=np.float32),
        [np.asarray([0.0, 1.0], dtype=np.float32)],
    )

    assert result[0] > 0.99
    assert 0 < result[1] < 0.03


def wav_base64(duration_ms: int, sample_rate: int = 16000) -> str:
    samples = int(sample_rate * duration_ms / 1000)
    output = io.BytesIO()
    with wave.open(output, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * samples)
    return base64.b64encode(output.getvalue()).decode()
