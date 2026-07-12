import base64
import struct
import wave

from app.qwen3_engine import Qwen3AsrEngine, qwen3_language
from app.schemas import AsrTranscribeRequest


class FakeQwen3Runner:
    def __init__(self, text: str = "hello from qwen3") -> None:
        self.text = text
        self.calls = 0
        self.last_language: str | None = None
        self.last_context = ""
        self.last_sample_rate = 0

    def transcribe(self, audio_path: str, language: str | None, context: str) -> str:
        self.calls += 1
        self.last_language = language
        self.last_context = context
        with wave.open(audio_path, "rb") as wav_file:
            self.last_sample_rate = wav_file.getframerate()
        return self.text


async def test_qwen3_engine_flushes_buffered_transcript() -> None:
    runner = FakeQwen3Runner("今天下午三点我们讨论产品计划")
    engine = qwen_engine(runner)

    assert await engine.transcribe(frame(sequence=1)) is None
    result = await engine.flush("sess_1", "zh", "en")

    assert result is not None
    assert result.segmentId == "qwen3_flush_1"
    assert result.text == "今天下午三点我们讨论产品计划"
    assert result.language == "zh"
    assert runner.last_language == "Chinese"
    assert runner.last_context == ""
    assert runner.last_sample_rate == 16000


async def test_qwen3_engine_transcribes_confirmed_speaker_boundary() -> None:
    runner = FakeQwen3Runner("第一位说话人的完整句子")
    engine = qwen_engine(runner, min_audio_ms=2000)

    assert await engine.transcribe(frame(sequence=1)) is None
    assert await engine.transcribe(frame(sequence=2)) is None
    result = await engine.commit_boundary("sess_1", 1000, "zh", "en")

    assert result is not None
    assert result.segmentId == "qwen3_boundary_1"
    assert result.timing == {
        "startMs": 500,
        "endMs": 1000,
        "source": "client",
    }


async def test_qwen3_engine_dedupes_adjacent_transcripts() -> None:
    runner = FakeQwen3Runner("What is your name?")
    engine = qwen_engine(runner, min_audio_ms=200)

    await engine.transcribe(frame(sequence=1, duration_ms=200, source_language="en"))
    first = await engine.flush("sess_1", "en", "zh")
    await engine.transcribe(frame(
        sequence=2,
        duration_ms=200,
        source_language="en",
        timestamp_ms=300,
    ))
    second = await engine.flush("sess_1", "en", "zh")

    assert first is not None
    assert first.language == "en"
    assert second is None


async def test_qwen3_engine_keeps_repeated_non_overlapping_utterances() -> None:
    runner = FakeQwen3Runner("What is your name?")
    engine = qwen_engine(runner, min_audio_ms=200)

    await engine.transcribe(frame(sequence=1, duration_ms=200, source_language="en"))
    first = await engine.flush("sess_1", "en", "zh")
    await engine.transcribe(frame(
        sequence=2,
        duration_ms=200,
        source_language="en",
        timestamp_ms=1000,
    ))
    second = await engine.flush("sess_1", "en", "zh")

    assert first is not None
    assert second is not None
    assert second.text == "What is your name?"


def test_qwen3_language_maps_app_language_codes() -> None:
    assert qwen3_language("zh") == "Chinese"
    assert qwen3_language("zh-CN") == "Chinese"
    assert qwen3_language("en") == "English"
    assert qwen3_language("en-US") == "English"
    assert qwen3_language("auto") is None


async def test_qwen3_engine_uses_empty_context_for_english() -> None:
    runner = FakeQwen3Runner("This is a narrow band phone call test.")
    engine = qwen_engine(runner)

    await engine.transcribe(frame(sequence=1, source_language="en"))
    result = await engine.flush("sess_1", "en", "zh")

    assert result is not None
    assert runner.last_language == "English"
    assert runner.last_context == ""


async def test_qwen3_engine_adds_hotwords_to_context() -> None:
    runner = FakeQwen3Runner("我们要测试筑基丹和灵脉之心")
    engine = qwen_engine(runner, min_audio_ms=200)

    await engine.transcribe(frame(
        sequence=1,
        duration_ms=200,
        hotwords=["筑基丹", "灵脉之心", "Hy-MT2"],
        corrections=[{"fromText": "助机单", "toText": "筑基丹"}],
    ))
    await engine.flush("sess_1", "zh", "en")

    assert "优先识别并保留以下热词" in runner.last_context
    assert "筑基丹" in runner.last_context
    assert "助机单=>筑基丹" in runner.last_context


async def test_qwen3_engine_rejects_correction_prompt_echo() -> None:
    runner = FakeQwen3Runner(
        "常见误识别纠正：报价合同=>报价、合同；客户单价=>客单价；"
        "检票号=>检票口。"
    )
    engine = qwen_engine(runner, min_audio_ms=200)

    await engine.transcribe(frame(
        sequence=1,
        duration_ms=200,
        corrections=[
            {"fromText": "报价合同", "toText": "报价、合同"},
            {"fromText": "客户单价", "toText": "客单价"},
            {"fromText": "检票号", "toText": "检票口"},
        ],
    ))
    result = await engine.flush("sess_1", "zh", "en")

    assert result is None


async def test_qwen3_engine_rejects_partial_context_echo_without_prefix() -> None:
    runner = FakeQwen3Runner(
        "报价合同报价合同客户单价客单价检票号检票口"
    )
    engine = qwen_engine(runner, min_audio_ms=200)

    await engine.transcribe(frame(
        sequence=1,
        duration_ms=200,
        corrections=[
            {"fromText": "报价合同", "toText": "报价合同"},
            {"fromText": "客户单价", "toText": "客单价"},
            {"fromText": "检票号", "toText": "检票口"},
        ],
    ))
    result = await engine.flush("sess_1", "zh", "en")

    assert result is None


async def test_qwen3_engine_keeps_real_speech_with_domain_terms() -> None:
    runner = FakeQwen3Runner("请检查数据库网关和客单价是否正确")
    engine = qwen_engine(runner, min_audio_ms=200)

    await engine.transcribe(frame(
        sequence=1,
        duration_ms=200,
        hotwords=["数据库", "网关", "客单价"],
        corrections=[{"fromText": "客户单价", "toText": "客单价"}],
    ))
    result = await engine.flush("sess_1", "zh", "en")

    assert result is not None
    assert result.text == "请检查数据库网关和客单价是否正确"


def qwen_engine(
    runner: FakeQwen3Runner,
    min_audio_ms: int = 500,
) -> Qwen3AsrEngine:
    return Qwen3AsrEngine(
        model_dir="/unused",
        dtype="bfloat16",
        device_map="cuda:0",
        max_inference_batch_size=1,
        max_new_tokens=256,
        min_audio_ms=min_audio_ms,
        endpoint_silence_ms=600,
        max_audio_ms=8000,
        preroll_ms=0,
        vad_energy_threshold=350,
        context="",
        english_context="",
        runner=runner,
    )


def frame(
    sequence: int,
    duration_ms: int = 500,
    source_language: str = "zh",
    hotwords: list[str] | None = None,
    corrections: list[dict[str, str]] | None = None,
    timestamp_ms: int | None = None,
) -> AsrTranscribeRequest:
    sample_rate = 16000
    sample_count = sample_rate * duration_ms // 1000
    pcm = b"".join(struct.pack("<h", 1000) for _ in range(sample_count))
    return AsrTranscribeRequest(
        sessionId="sess_1",
        sequence=sequence,
        timestampMs=timestamp_ms if timestamp_ms is not None else sequence * duration_ms,
        format="pcm16",
        sampleRate=sample_rate,
        data=base64.b64encode(pcm).decode("ascii"),
        sourceLanguage=source_language,
        targetLanguage="en" if source_language == "zh" else "zh",
        hotwords=hotwords or [],
        corrections=corrections or [],
    )
