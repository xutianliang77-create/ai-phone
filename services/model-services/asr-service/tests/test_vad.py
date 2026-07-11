import struct

from app.vad import MarbleNetVadProvider, RmsVadProvider, VadDecision


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


def silence_pcm() -> bytes:
    return b"\0" * 1920


def voice_pcm() -> bytes:
    return struct.pack("<" + "h" * 960, *([1000] * 960))
