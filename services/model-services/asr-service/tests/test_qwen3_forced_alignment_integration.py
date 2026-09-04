import wave

from app.qwen3_forced_aligner import AlignedToken
from tests.test_qwen3_engine import FakeQwen3Runner, frame, qwen_engine


class FakeForcedAligner:
    def __init__(self) -> None:
        self.calls = 0
        self.last_language: str | None = None
        self.shutdown_calls = 0

    def align(self, audio_path: str, text: str, language: str | None):
        self.calls += 1
        self.last_language = language
        assert text == "今天讨论计划"
        with wave.open(audio_path, "rb") as audio:
            assert audio.getframerate() == 16000
        return (
            AlignedToken("今天", 0, 200, character_start=0, character_end=2),
            AlignedToken("讨论计划", 200, 500, character_start=2, character_end=6),
        )

    def shutdown(self) -> None:
        self.shutdown_calls += 1


async def test_qwen3_engine_offsets_forced_alignment_to_segment_timeline() -> None:
    runner = FakeQwen3Runner("今天讨论计划")
    aligner = FakeForcedAligner()
    engine = qwen_engine(runner, forced_aligner=aligner)

    assert await engine.transcribe(frame(sequence=1)) is None
    result = await engine.flush("sess_1", "zh", "en")

    assert result is not None
    assert [item.model_dump() for item in result.tokenTimings or []] == [
        {
            "text": "今天",
            "startMs": 500,
            "endMs": 700,
            "confidence": None,
            "characterStart": 0,
            "characterEnd": 2,
        },
        {
            "text": "讨论计划",
            "startMs": 700,
            "endMs": 1000,
            "confidence": None,
            "characterStart": 2,
            "characterEnd": 6,
        },
    ]
    assert aligner.calls == 1
    assert aligner.last_language == "Chinese"
    engine.shutdown()
    assert aligner.shutdown_calls == 1


async def test_qwen3_engine_clamps_alignment_rounding_to_segment_end() -> None:
    class RoundingAligner(FakeForcedAligner):
        def align(self, audio_path: str, text: str, language: str | None):
            return (AlignedToken(text, 0, 520),)

    engine = qwen_engine(
        FakeQwen3Runner("今天讨论计划"),
        forced_aligner=RoundingAligner(),
    )

    assert await engine.transcribe(frame(sequence=1)) is None
    result = await engine.flush("sess_1", "zh", "en")

    assert result is not None
    assert result.timing == {"startMs": 500, "endMs": 1000, "source": "client"}
    assert result.tokenTimings is not None
    assert result.tokenTimings[0].endMs == 1000
