import asyncio

from app.mock_engine import MockAsrEngine
from app.schemas import AsrTranscribeRequest


def test_mock_engine_emits_on_configured_interval() -> None:
    engine = MockAsrEngine(emit_every_frames=2)

    first = asyncio.run(engine.transcribe(request(sequence=1)))
    second = asyncio.run(engine.transcribe(request(sequence=2)))

    assert first is None
    assert second is not None
    assert second.language == "en"
    assert second.text == "hello, this is a realtime translation test"


def test_mock_engine_ignores_duplicate_sequences() -> None:
    engine = MockAsrEngine(emit_every_frames=1)

    asyncio.run(engine.transcribe(request(sequence=1)))
    duplicate = asyncio.run(engine.transcribe(request(sequence=1)))

    assert duplicate is None


def request(sequence: int) -> AsrTranscribeRequest:
    return AsrTranscribeRequest(
        sessionId="sess_1",
        sequence=sequence,
        timestampMs=sequence,
        format="pcm16",
        sampleRate=24000,
        data="AA==",
        sourceLanguage="en",
        targetLanguage="zh",
    )
