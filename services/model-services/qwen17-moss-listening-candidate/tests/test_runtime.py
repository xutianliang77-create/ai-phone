import base64
import struct
import time
import wave
from pathlib import Path

import numpy as np

from candidate_service.runtime import CandidateEngine
from candidate_service.diagnostic_capture import DiagnosticCapture
from candidate_service.state import CandidateConfig
from candidate_service.audio import confirmed_readable_prefix
from candidate_service.models import forced_language
from candidate_service.vad import (
    MarbleNetVadProvider,
    RmsVadProvider,
    VadDecision,
)


class FakeState:
    def __init__(self) -> None:
        self.calls = 0
        self.language = "Spanish"


class FakeQwen:
    def __init__(self) -> None:
        self.batch_calls = 0
        self.last_final_samples = 0
        self.final_sample_history: list[int] = []

    def new_state(self, _source_language: str):
        return FakeState()

    def push(self, state, _audio: np.ndarray):
        state.calls += 1
        texts = {
            1: "No",
            2: "No carga",
            3: "No carga y y tampoco",
        }
        return state.calls, texts.get(state.calls, texts[3]), state.language

    def finish(self, state):
        return "No carga y y tampoco.", state.language

    def transcribe_final(
        self,
        audio: np.ndarray,
        _source_language: str,
        _detected_language: str,
    ):
        self.batch_calls += 1
        self.last_final_samples = len(audio)
        self.final_sample_history.append(len(audio))
        return "No carga y y tampoco.", "Spanish"


class FailingBatchQwen(FakeQwen):
    def transcribe_final(
        self,
        _audio: np.ndarray,
        _source_language: str,
        _detected_language: str,
    ):
        raise RuntimeError("batch failed")


class FakeMoss:
    def transcribe(self, _audio: np.ndarray):
        return "No carga y tampoco. Cola equivocada.", 1


class FixedFinalQwen(FakeQwen):
    def __init__(self, text: str) -> None:
        super().__init__()
        self.text = text

    def transcribe_final(
        self,
        audio: np.ndarray,
        _source_language: str,
        _detected_language: str,
    ):
        self.batch_calls += 1
        self.last_final_samples = len(audio)
        self.final_sample_history.append(len(audio))
        return self.text, "Chinese"


class WeakProbabilityVad:
    def analyze(
        self,
        _session_id: str,
        pcm: np.ndarray,
        _sample_rate: int,
    ) -> VadDecision:
        voiced = bool(np.max(np.abs(pcm), initial=0) > 0)
        return VadDecision(voiced, 0.2 if voiced else 0.01, "fake")

    def diagnostics(self, _session_id: str) -> dict[str, object]:
        return {}

    def health_diagnostics(self) -> dict[str, object]:
        return {"activeProvider": "fake"}

    def close_session(self, _session_id: str) -> None:
        return None


class FakeMarbleNet:
    def speech_probability(
        self,
        pcm: bytes,
        _sample_rate: int,
        _current_duration_ms: int,
        _smoothing_frames: int,
    ) -> float:
        samples = np.frombuffer(pcm, dtype="<i2")
        return 0.9 if np.max(np.abs(samples), initial=0) > 0 else 0.1


def test_emits_stable_partial_final_and_surgical_revision() -> None:
    qwen = FakeQwen()
    engine = CandidateEngine(
        qwen,
        FakeMoss(),
        CandidateConfig(
            endpoint_silence_ms=100,
            max_audio_ms=10000,
            preroll_ms=0,
            vad_rms_threshold=10,
        ),
    )
    responses = []
    for sequence, amplitude in enumerate((1000, 1000, 1000, 0, 0), 1):
        response = engine.process_frame(frame(sequence, amplitude))
        if response:
            responses.append(response)
        time.sleep(0.01)
    for sequence in range(6, 20):
        response = engine.process_frame(frame(sequence, 0))
        if response:
            responses.append(response)
        if any(item["revision"] >= 2 for item in responses):
            break
        time.sleep(0.01)

    assert any(item["text"] == "No carga" for item in responses)
    assert any(item["text"] == "No carga y y tampoco." for item in responses)
    assert any(item["text"] == "No carga y tampoco." for item in responses)
    assert qwen.batch_calls == 1
    assert engine.status()["metrics"]["batchFinals"] == 1
    assert engine.status()["metrics"]["batchFinalFallbacks"] == 0
    assert engine.status()["metrics"]["revisionsApplied"] == 1
    engine.shutdown()


def test_confirmed_prefix_requires_two_readable_units() -> None:
    assert confirmed_readable_prefix("嗯", "嗯好", 2) is None
    assert confirmed_readable_prefix("Hello w", "Hello world", 2) == "Hello w"


def test_suppresses_low_evidence_silence_hallucination() -> None:
    engine = CandidateEngine(
        FixedFinalQwen("Yeah."),
        FakeMoss(),
        CandidateConfig(
            endpoint_silence_ms=100,
            max_audio_ms=10000,
            preroll_ms=0,
        ),
        vad=WeakProbabilityVad(),
    )

    requests = [frame(1, 1000), frame(2, 0), frame(3, 0)]
    for request in requests:
        request["sourceLanguage"] = "zh-CN"
    responses = [engine.process_frame(request) for request in requests]

    assert not any(item and item.get("endpointReason") for item in responses)
    assert engine.status()["metrics"]["silenceHallucinationsSuppressed"] == 1
    engine.shutdown()


def test_keeps_short_sentences_numbers_and_latin_entities() -> None:
    for text in ("今天开会。", "18", "OpenAI"):
        engine = CandidateEngine(
            FixedFinalQwen(text),
            FakeMoss(),
            CandidateConfig(
                endpoint_silence_ms=100,
                max_audio_ms=10000,
                preroll_ms=0,
            ),
            vad=WeakProbabilityVad(),
        )

        requests = [frame(1, 1000), frame(2, 0), frame(3, 0)]
        for request in requests:
            request["sourceLanguage"] = "zh-CN"
        responses = [engine.process_frame(request) for request in requests]

        assert any(
            item and item.get("endpointReason") and item["text"] == text
            for item in responses
        )
        engine.shutdown()


def test_batch_final_failure_falls_back_to_streaming_final() -> None:
    engine = CandidateEngine(
        FailingBatchQwen(),
        FakeMoss(),
        CandidateConfig(
            endpoint_silence_ms=100,
            max_audio_ms=10000,
            preroll_ms=0,
            vad_rms_threshold=10,
        ),
    )

    responses = [
        engine.process_frame(frame(1, 1000)),
        engine.process_frame(frame(2, 0)),
        engine.process_frame(frame(3, 0)),
    ]

    assert any(
        item and item["text"] == "No carga y y tampoco."
        for item in responses
    )
    assert engine.status()["metrics"]["batchFinals"] == 0
    assert engine.status()["metrics"]["batchFinalFallbacks"] == 1
    engine.shutdown()


def test_diagnostics_are_scoped_to_the_requested_session() -> None:
    engine = CandidateEngine(FakeQwen(), FakeMoss())

    engine.process_frame(frame(1, 1000, session_id="first"))
    engine.process_frame(frame(1, 0, session_id="second"))

    first = engine.diagnostics("first")
    second = engine.diagnostics("second")
    assert first["analyzedFrameCount"] == 1
    assert first["speechFrameCount"] == 1
    assert second["analyzedFrameCount"] == 1
    assert second["speechFrameCount"] == 0
    assert engine.status()["metrics"]["frames"] == 2
    engine.shutdown()


def test_max_duration_uses_bounded_audio_for_batch_final() -> None:
    qwen = FakeQwen()
    engine = CandidateEngine(
        qwen,
        FakeMoss(),
        CandidateConfig(
            endpoint_silence_ms=10000,
            max_audio_ms=300,
            preroll_ms=0,
            vad_rms_threshold=10,
        ),
    )

    responses = [
        engine.process_frame(frame(sequence, 1000))
        for sequence in range(1, 5)
    ]

    assert qwen.batch_calls == 1
    assert qwen.last_final_samples == 4800
    assert any(
        item and item.get("endpointReason") == "max_duration"
        for item in responses
    )
    engine.shutdown()


def test_confirmed_speaker_boundary_splits_and_retains_following_audio() -> None:
    qwen = FixedFinalQwen("first turn")
    engine = CandidateEngine(
        qwen,
        FakeMoss(),
        CandidateConfig(
            endpoint_silence_ms=10000,
            max_audio_ms=10000,
            preroll_ms=0,
            vad_rms_threshold=10,
        ),
    )

    for sequence in range(1, 4):
        engine.process_frame(frame(sequence, 1000))

    previous = engine.commit_boundary("session-1", "auto", 260)
    following = engine.flush("session-1", "auto")

    assert previous is not None
    assert previous["segmentId"] == "qwen17_1"
    assert previous["endpointReason"] == "speaker_boundary"
    assert previous["timing"] == {
        "startMs": 100,
        "endMs": 260,
        "source": "server",
    }
    assert following is not None
    assert following["segmentId"] == "qwen17_2"
    assert following["timing"] == {
        "startMs": 260,
        "endMs": 400,
        "source": "server",
    }
    assert qwen.final_sample_history == [2560, 2240]
    assert engine.status()["metrics"]["boundarySplitHits"] == 1
    assert engine.status()["metrics"]["boundarySplitFallbacks"] == 0
    engine.shutdown()


def test_speaker_boundary_falls_back_without_mutating_a_too_short_turn() -> None:
    qwen = FakeQwen()
    engine = CandidateEngine(
        qwen,
        FakeMoss(),
        CandidateConfig(
            endpoint_silence_ms=10000,
            max_audio_ms=10000,
            preroll_ms=0,
            vad_rms_threshold=10,
        ),
    )
    engine.process_frame(frame(1, 1000))

    assert engine.commit_boundary("session-1", "auto", 150) is None
    final = engine.flush("session-1", "auto")

    assert final is not None
    assert final["timing"] == {
        "startMs": 100,
        "endMs": 200,
        "source": "server",
    }
    assert qwen.final_sample_history == [1600]
    assert engine.status()["metrics"]["boundarySplitHits"] == 0
    assert engine.status()["metrics"]["boundarySplitFallbacks"] == 1
    engine.shutdown()


def test_forces_selected_languages_but_keeps_auto_detection() -> None:
    assert forced_language("zh-CN") == "Chinese"
    assert forced_language("en") == "English"
    assert forced_language("auto") is None


def test_default_vad_keeps_low_level_far_field_speech() -> None:
    engine = CandidateEngine(FakeQwen(), FakeMoss())

    engine.process_frame(frame(1, 150))

    diagnostics = engine.diagnostics("session-1")
    assert diagnostics["speechFrameCount"] == 1
    assert diagnostics["candidate"]["sessionActive"] is True
    engine.shutdown()


def test_marblenet_vad_replaces_fixed_rms_gate_and_reports_probability() -> None:
    vad = MarbleNetVadProvider(
        FakeMarbleNet(),
        threshold=0.5,
        window_ms=1000,
        smoothing_frames=3,
        fallback=RmsVadProvider(100),
        model_fingerprint="abc123",
    )
    engine = CandidateEngine(FakeQwen(), FakeMoss(), vad=vad)

    engine.process_frame(frame(1, 20))
    diagnostics = engine.diagnostics("session-1")

    assert diagnostics["configuredProvider"] == "marblenet"
    assert diagnostics["activeProvider"] == "marblenet"
    assert diagnostics["speechFrameCount"] == 1
    assert diagnostics["probabilityMax"] == 0.9
    assert diagnostics["rmsMax"] == 20
    assert diagnostics["modelFingerprint"] == "abc123"
    assert engine.status()["vad"]["activeProvider"] == "marblenet"
    engine.shutdown()


def test_one_shot_diagnostic_capture_writes_bounded_pcm_wav(tmp_path) -> None:
    capture = DiagnosticCapture(
        str(tmp_path),
        max_sessions=1,
        max_seconds=1,
    )
    engine = CandidateEngine(
        FakeQwen(),
        FakeMoss(),
        diagnostic_capture=capture,
    )

    engine.process_frame(frame(1, 200, session_id="captured"))
    engine.process_frame(frame(1, 300, session_id="ignored"))
    engine.close_session("captured")

    path = Path(tmp_path) / "captured.wav"
    assert path.stat().st_mode & 0o777 == 0o600
    with wave.open(str(path), "rb") as audio:
        assert audio.getframerate() == 16000
        assert audio.getnchannels() == 1
        assert audio.getnframes() == 1600
    assert not (Path(tmp_path) / "ignored.wav").exists()
    assert engine.status()["diagnosticCapture"]["acceptedSessions"] == 1
    engine.shutdown()


def frame(
    sequence: int,
    amplitude: int,
    *,
    session_id: str = "session-1",
) -> dict[str, object]:
    samples = [amplitude] * 1600
    pcm = b"".join(struct.pack("<h", value) for value in samples)
    return {
        "sessionId": session_id,
        "sequence": sequence,
        "timestampMs": sequence * 100,
        "format": "pcm16",
        "sampleRate": 16000,
        "data": base64.b64encode(pcm).decode(),
        "sourceLanguage": "auto",
        "targetLanguage": "zh",
        "mode": "listening",
    }
