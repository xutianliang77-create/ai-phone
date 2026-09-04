import time
import wave
from pathlib import Path

from candidate_service.runtime import CandidateEngine
from candidate_service.diagnostic_capture import DiagnosticCapture
from candidate_service.state import CandidateConfig
from candidate_service.audio import confirmed_readable_prefix
from candidate_service.models import forced_language
from candidate_service.vad import (
    MarbleNetVadProvider,
    RmsVadProvider,
)
from runtime_test_support import (
    FailingBatchQwen,
    FakeMarbleNet,
    FakeMoss,
    FakeQwen,
    FixedFinalQwen,
    WeakProbabilityVad,
    frame,
)


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
