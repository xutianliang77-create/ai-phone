import base64
import struct
import wave

from app.schemas import AsrTranscribeRequest
from app.sensevoice_engine import (
    SenseVoiceEngine,
    extract_text,
    infer_transcript_language,
    normalize_transcript,
    pcm16_signal_metrics,
)


def test_extract_text_from_funasr_result() -> None:
    assert extract_text([{"text": " hello "}]) == " hello "


async def test_sensevoice_engine_buffers_audio_until_min_duration() -> None:
    runner = FakeSenseVoiceRunner()
    engine = SenseVoiceEngine(
        model_dir="iic/SenseVoiceSmall",
        device="cpu",
        min_audio_ms=80,
        endpoint_silence_ms=0,
        runner=runner,
    )

    first = await engine.transcribe(request(sequence=1, pcm=voice_pcm()))
    second = await engine.transcribe(request(sequence=2, pcm=voice_pcm()))

    assert first is None
    assert second is not None
    assert second.text == "hello from sensevoice"
    assert second.language == "en"
    assert runner.last_language == "en"
    assert runner.last_sample_rate == 24000


async def test_sensevoice_external_segment_bypasses_service_vad() -> None:
    runner = FakeSenseVoiceRunner()
    engine = SenseVoiceEngine(
        model_dir="iic/SenseVoiceSmall",
        device="cpu",
        min_audio_ms=1000,
        endpoint_silence_ms=1000,
        runner=runner,
    )

    def unexpected_vad(_request):
        raise AssertionError("service VAD must not inspect an ESP32-bounded segment")

    engine.segmenter.append = unexpected_vad
    transcript = await engine.transcribe_segment(
        request(sequence=7, pcm=voice_pcm(), source_language="en")
    )

    assert transcript is not None
    assert transcript.segmentId == "sensevoice_device_vad_7"
    assert transcript.endpointReason == "device_vad"
    assert transcript.vadContext == {
        "provider": "external",
        "source": "esp32-afe-v1",
    }
    assert runner.last_sample_rate == 24000


async def test_sensevoice_engine_dedupes_adjacent_transcripts() -> None:
    runner = FakeSenseVoiceRunner()
    engine = SenseVoiceEngine(
        model_dir="iic/SenseVoiceSmall",
        device="cpu",
        min_audio_ms=40,
        endpoint_silence_ms=0,
        runner=runner,
    )

    first = await engine.transcribe(request(sequence=1, pcm=voice_pcm()))
    duplicate = await engine.transcribe(request(sequence=2, pcm=voice_pcm()))

    assert first is not None
    assert duplicate is None


async def test_sensevoice_engine_flushes_active_audio() -> None:
    runner = FakeSenseVoiceRunner()
    engine = SenseVoiceEngine(
        model_dir="iic/SenseVoiceSmall",
        device="cpu",
        min_audio_ms=1000,
        endpoint_silence_ms=1000,
        runner=runner,
    )

    assert await engine.transcribe(request(sequence=1, pcm=voice_pcm())) is None
    transcript = await engine.flush(
        session_id="sess_1",
        source_language="en",
        target_language="zh",
    )

    assert transcript is not None
    assert transcript.segmentId == "sensevoice_flush_1"
    assert transcript.text == "hello from sensevoice"


async def test_sensevoice_engine_inferrs_auto_language_from_text() -> None:
    runner = FakeSenseVoiceRunner(text="你好，这是中文测试")
    engine = SenseVoiceEngine(
        model_dir="iic/SenseVoiceSmall",
        device="cpu",
        min_audio_ms=40,
        endpoint_silence_ms=0,
        runner=runner,
    )

    transcript = await engine.transcribe(
        request(
            sequence=1,
            pcm=voice_pcm(),
            source_language="auto",
            target_language="zh",
        ),
    )

    assert transcript is not None
    assert transcript.language == "zh"
    assert runner.last_language == "auto"


def test_infer_transcript_language_handles_mixed_text() -> None:
    assert infer_transcript_language("What's your name?") == "en"
    assert infer_transcript_language("你好 what's your name") == "zh"
    assert infer_transcript_language("12345") is None


def test_normalize_transcript_removes_case_space_and_punctuation() -> None:
    assert normalize_transcript(" Hello, World! ") == "helloworld"
    assert normalize_transcript(" <sil> [noise] ") == ""
    assert normalize_transcript(" <|nospeech|> (no speech) ") == ""
    assert normalize_transcript("你好 <sil> ") == "你好"


def test_pcm_metrics_report_duration_energy_peak_and_zero_ratio() -> None:
    pcm = struct.pack("<" + "h" * 16000, *([0] * 8000 + [1000] * 8000))

    metrics = pcm16_signal_metrics(pcm, 16000)

    assert metrics["duration_ms"] == 1000
    assert metrics["rms"] > 0
    assert metrics["peak"] == 1000
    assert metrics["zero_percent"] == 50.0


class FakeSenseVoiceRunner:
    def __init__(self, text: str = "hello from sensevoice") -> None:
        self.text = text
        self.last_language = ""
        self.last_sample_rate = 0

    def transcribe(self, audio_path: str, language: str) -> str:
        self.last_language = language
        with wave.open(audio_path, "rb") as wav_file:
            self.last_sample_rate = wav_file.getframerate()
        return f" {self.text} "


def voice_pcm(amplitude: int = 1000) -> bytes:
    return struct.pack("<" + "h" * 960, *([amplitude] * 960))


def request(
    sequence: int,
    pcm: bytes | None = None,
    source_language: str = "en",
    target_language: str = "zh",
) -> AsrTranscribeRequest:
    audio = pcm or voice_pcm()
    return AsrTranscribeRequest(
        sessionId="sess_1",
        sequence=sequence,
        timestampMs=sequence,
        format="pcm16",
        sampleRate=24000,
        data=base64.b64encode(audio).decode("ascii"),
        sourceLanguage=source_language,
        targetLanguage=target_language,
    )
