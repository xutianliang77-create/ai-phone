from fastapi.testclient import TestClient

from app.config import AsrConfig
from app.main import create_app
from tests.route_test_support import stream_frame


def test_stream_route_accepts_binary_pcm_and_flushes() -> None:
    client = TestClient(create_app(AsrConfig(mock_emit_every_frames=1)))
    with client.websocket_connect("/asr/stream") as websocket:
        websocket.send_json({
            "type": "session.open",
            "sessionId": "stream_1:guest",
            "sourceLanguage": "auto",
            "targetLanguage": "zh",
            "mode": "call_link",
        })
        assert websocket.receive_json()["type"] == "session.ready"
        websocket.send_bytes(stream_frame(sequence=1, request_id="frame:1"))
        result = websocket.receive_json()
        assert result["type"] == "asr.result"
        assert result["requestId"] == "frame:1"
        assert result["sequence"] == 1
        assert result["transcript"]["language"] == "en"
        websocket.send_json({"type": "session.flush", "requestId": "flush:1"})
        assert websocket.receive_json()["type"] == "session.flushed"


def test_stream_route_rejects_wrong_api_key() -> None:
    client = TestClient(create_app(AsrConfig(api_key="asr-secret")))
    with client.websocket_connect("/asr/stream") as websocket:
        websocket.send_json({
            "type": "session.open",
            "sessionId": "stream_1:guest",
            "apiKey": "wrong",
        })
        try:
            websocket.receive_json()
            assert False, "expected websocket disconnect"
        except Exception:
            pass
