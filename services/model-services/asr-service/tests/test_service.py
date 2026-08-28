from app.schemas import (
    AsrBoundaryRequest,
    AsrCorrectionTerm,
    AsrFlushRequest,
    AsrTranscribeRequest,
    AsrTranscribeResponse,
)
from app.service import AsrService, corrected_response


async def test_service_applies_explicit_corrections_to_every_final_path() -> None:
    service = AsrService(FakeEngine())
    correction = AsrCorrectionTerm(fromText="同船", toText="同传")

    transcribed = await service.transcribe(transcribe_request(correction))
    externally_segmented = await service.transcribe_segment(
        transcribe_request(correction)
    )
    flushed = await service.flush("session-1", flush_request(correction))
    boundary = await service.commit_boundary(
        "session-1",
        AsrBoundaryRequest(**flush_request(correction).model_dump(), boundaryMs=600),
    )

    assert transcribed is not None and transcribed.text == "在线同传测试"
    assert externally_segmented is not None and externally_segmented.text == "在线同传测试"
    assert flushed is not None and flushed.text == "在线同传测试"
    assert boundary is not None and boundary.text == "在线同传测试"


def test_corrections_are_longest_first_case_insensitive_and_non_cascading() -> None:
    result = corrected_response(
        response("Hi MT Two and Hi MT"),
        [
            AsrCorrectionTerm(fromText="Hi MT", toText="Hy-MT"),
            AsrCorrectionTerm(fromText="Hi MT Two", toText="Hy-MT2"),
            AsrCorrectionTerm(fromText="Hy-MT", toText="unexpected cascade"),
        ],
    )

    assert result is not None
    assert result.text == "Hy-MT2 and Hy-MT"


class FakeEngine:
    async def transcribe(self, _request):
        return response("在线同船测试")

    async def transcribe_segment(self, _request):
        return response("在线同船测试")

    async def flush(self, **_kwargs):
        return response("在线同船测试")

    async def commit_boundary(self, **_kwargs):
        return response("在线同船测试")

    async def close_session(self, _session_id):
        return None


def transcribe_request(correction: AsrCorrectionTerm) -> AsrTranscribeRequest:
    return AsrTranscribeRequest(
        sessionId="session-1",
        sequence=1,
        timestampMs=1,
        format="pcm16",
        sampleRate=24000,
        data="AA==",
        sourceLanguage="zh",
        targetLanguage="en",
        corrections=[correction],
    )


def flush_request(correction: AsrCorrectionTerm) -> AsrFlushRequest:
    return AsrFlushRequest(
        sourceLanguage="zh",
        targetLanguage="en",
        corrections=[correction],
    )


def response(text: str) -> AsrTranscribeResponse:
    return AsrTranscribeResponse(
        segmentId="segment-1",
        text=text,
        language="zh",
    )
