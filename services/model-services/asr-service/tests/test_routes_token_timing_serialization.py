from fastapi.testclient import TestClient

from app.config import AsrConfig
from app.main import create_app
from app.schemas import AsrTokenTiming, AsrTranscribeResponse
from tests.route_test_support import flush_payload, payload


class TokenTimingEngine:
    async def transcribe(self, request):
        return response("seg_transcribe")

    async def flush(self, session_id, source_language, target_language):
        return response("seg_flush")

    async def commit_boundary(
        self,
        session_id,
        boundary_ms,
        source_language,
        target_language,
    ):
        return response("seg_boundary")

    async def close_session(self, session_id):
        return None


def test_http_routes_omit_null_token_fields() -> None:
    client = TestClient(create_app(
        AsrConfig(provider="mock"),
        engine_loader=lambda _config: TokenTimingEngine(),
    ))

    responses = [
        client.post("/asr/transcribe", json=payload(sequence=1)),
        client.post("/asr/sessions/sess_1/flush", json=flush_payload()),
        client.post(
            "/asr/sessions/sess_1/boundary",
            json={**flush_payload(), "boundaryMs": 400},
        ),
    ]

    assert [item.status_code for item in responses] == [200, 200, 200]
    for item in responses:
        token = item.json()["tokenTimings"][0]
        assert token == {
            "text": "测试",
            "startMs": 100,
            "endMs": 500,
            "characterStart": 0,
            "characterEnd": 2,
        }
        assert "confidence" not in item.json()


def response(segment_id: str) -> AsrTranscribeResponse:
    return AsrTranscribeResponse(
        segmentId=segment_id,
        text="测试",
        language="zh",
        tokenTimings=[AsrTokenTiming(
            text="测试",
            startMs=100,
            endMs=500,
            characterStart=0,
            characterEnd=2,
        )],
    )
