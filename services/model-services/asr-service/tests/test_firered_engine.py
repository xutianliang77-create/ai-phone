import base64
import struct

from app.firered_engine import FireRedAsr2AedEngine
from app.schemas import AsrTranscribeRequest


class FakeFireRedRunner:
    def __init__(self, text: str) -> None:
        self.text = text
        self.calls = 0

    def transcribe(self, audio_path: str) -> str:
        self.calls += 1
        return self.text


async def test_firered_engine_flushes_buffered_transcript() -> None:
    runner = FakeFireRedRunner("今天下午三点我们讨论产品计划")
    engine = FireRedAsr2AedEngine(
        model_dir="/unused",
        use_gpu=False,
        beam_size=1,
        min_audio_ms=500,
        endpoint_silence_ms=600,
        max_audio_ms=8000,
        preroll_ms=0,
        vad_energy_threshold=350,
        runner=runner,
    )

    assert await engine.transcribe(frame(sequence=1)) is None
    result = await engine.flush("sess_1", "auto", "en")

    assert result is not None
    assert result.segmentId == "firered_flush_1"
    assert result.text == "今天下午三点我们讨论产品计划"
    assert result.language == "zh"


async def test_firered_engine_drops_duplicate_transcript() -> None:
    runner = FakeFireRedRunner("hello world")
    engine = FireRedAsr2AedEngine(
        model_dir="/unused",
        use_gpu=False,
        beam_size=1,
        min_audio_ms=200,
        endpoint_silence_ms=200,
        max_audio_ms=8000,
        preroll_ms=0,
        vad_energy_threshold=350,
        runner=runner,
    )

    await engine.transcribe(frame(sequence=1, duration_ms=200))
    first = await engine.flush("sess_1", "auto", "zh")
    await engine.transcribe(frame(sequence=2, duration_ms=200))
    second = await engine.flush("sess_1", "auto", "zh")

    assert first is not None
    assert first.language == "en"
    assert second is None


async def test_firered_engine_drops_silence_marker_transcript() -> None:
    runner = FakeFireRedRunner("<sil>")
    engine = FireRedAsr2AedEngine(
        model_dir="/unused",
        use_gpu=False,
        beam_size=1,
        min_audio_ms=200,
        endpoint_silence_ms=200,
        max_audio_ms=8000,
        preroll_ms=0,
        vad_energy_threshold=350,
        runner=runner,
    )

    await engine.transcribe(frame(sequence=1, duration_ms=200))
    result = await engine.flush("sess_1", "auto", "zh")

    assert result is None


def frame(sequence: int, duration_ms: int = 500) -> AsrTranscribeRequest:
    sample_rate = 16000
    sample_count = sample_rate * duration_ms // 1000
    pcm = b"".join(struct.pack("<h", 1000) for _ in range(sample_count))
    return AsrTranscribeRequest(
        sessionId="sess_1",
        sequence=sequence,
        timestampMs=sequence * duration_ms,
        format="pcm16",
        sampleRate=sample_rate,
        data=base64.b64encode(pcm).decode("ascii"),
        sourceLanguage="auto",
        targetLanguage="en",
    )
