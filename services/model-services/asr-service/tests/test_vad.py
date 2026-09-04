import struct
from types import SimpleNamespace

import app.marblenet_runtime as marblenet_runtime
from app.marblenet_runtime import import_onnxruntime
from app.vad import (
    MarbleNetVadProvider,
    RmsVadProvider,
    VadDecision,
    create_vad_provider,
)


class FakeRuntime:
    def __init__(self, probabilities: list[float]) -> None:
        self.probabilities = iter(probabilities)

    def speech_probability(
        self,
        pcm: bytes,
        sample_rate: int,
        current_duration_ms: int,
        smoothing_frames: int,
    ) -> float:
        del pcm, sample_rate, current_duration_ms, smoothing_frames
        return next(self.probabilities)


class FailingRuntime:
    def speech_probability(self, *args) -> float:
        raise RuntimeError("vad unavailable")


def test_rms_vad_detects_voice() -> None:
    provider = RmsVadProvider(energy_threshold=350)

    decision = provider.analyze("session", voice_pcm(), 24_000)

    assert decision.voiced is True
    assert decision.provider == "rms"


def test_marblenet_vad_uses_probability_threshold() -> None:
    provider = MarbleNetVadProvider(
        runtime=FakeRuntime([0.49, 0.5]),
        threshold=0.5,
        window_ms=1000,
        smoothing_frames=3,
        fallback=RmsVadProvider(350),
    )

    quiet = provider.analyze("session", silence_pcm(), 24_000)
    speech = provider.analyze("session", voice_pcm(), 24_000)

    assert quiet == VadDecision(False, 0.49, "marblenet")
    assert speech == VadDecision(True, 0.5, "marblenet")


def test_marblenet_vad_isolates_threshold_by_session() -> None:
    provider = MarbleNetVadProvider(
        runtime=FakeRuntime([0.1, 0.1]),
        threshold=0.5,
        window_ms=1000,
        smoothing_frames=3,
        fallback=RmsVadProvider(350),
    )

    listening = provider.analyze(
        "listening",
        voice_pcm(),
        24_000,
        threshold=0.05,
    )
    conversation = provider.analyze("conversation", voice_pcm(), 24_000)

    assert listening == VadDecision(True, 0.1, "marblenet")
    assert conversation == VadDecision(False, 0.1, "marblenet")
    assert provider.diagnostics("listening")["threshold"] == 0.05
    assert provider.diagnostics("listening")["speechFrameRatio"] == 1.0
    assert provider.diagnostics("conversation")["threshold"] == 0.5
    assert provider.diagnostics("conversation")["speechFrameRatio"] == 0.0


def test_marblenet_vad_falls_back_after_runtime_failure() -> None:
    provider = MarbleNetVadProvider(
        runtime=FailingRuntime(),
        threshold=0.5,
        window_ms=1000,
        smoothing_frames=3,
        fallback=RmsVadProvider(350),
    )

    first = provider.analyze("session", voice_pcm(), 24_000)
    second = provider.analyze("session", voice_pcm(), 24_000)

    assert first.voiced is True
    assert first.provider == "rms_fallback"
    assert second.provider == "rms_fallback"
    diagnostics = provider.diagnostics("session")
    assert diagnostics["activeProvider"] == "rms_fallback"
    assert diagnostics["fallbackReason"] == "runtime_failed"
    assert diagnostics["fallbackCount"] == 1
    assert diagnostics["analyzedFrameCount"] == 2


def test_missing_marblenet_assets_are_explicit_fallback(tmp_path) -> None:
    provider = create_vad_provider(
        provider="marblenet",
        model_path=str(tmp_path / "missing.onnx"),
        assets_path=str(tmp_path / "missing.npz"),
        threshold=0.7,
        window_ms=1000,
        smoothing_frames=3,
        fallback_energy_threshold=350,
    )

    provider.analyze("session", voice_pcm(), 24_000)
    diagnostics = provider.diagnostics("session")

    assert provider.name == "rms_fallback"
    assert diagnostics["configuredProvider"] == "marblenet"
    assert diagnostics["fallbackReason"] == "assets_missing"
    assert diagnostics["speechFrameRatio"] == 1.0


def test_onnxruntime_can_be_loaded_from_an_isolated_fallback_path(
    monkeypatch,
) -> None:
    imported = SimpleNamespace(name="onnxruntime")
    calls = 0

    def fake_import(name: str):
        nonlocal calls
        calls += 1
        if calls == 1:
            error = ModuleNotFoundError("onnxruntime is isolated")
            error.name = "onnxruntime"
            raise error
        assert name == "onnxruntime"
        return imported

    monkeypatch.setenv("ASR_ONNXRUNTIME_SITE_PACKAGES", "/isolated/onnxruntime")
    monkeypatch.setattr(marblenet_runtime.importlib, "import_module", fake_import)
    monkeypatch.setattr(marblenet_runtime.sys, "path", [])

    assert import_onnxruntime() is imported
    assert "/isolated/onnxruntime" in marblenet_runtime.sys.path


def silence_pcm() -> bytes:
    return b"\0" * 1920


def voice_pcm() -> bytes:
    return struct.pack("<" + "h" * 960, *([1000] * 960))
