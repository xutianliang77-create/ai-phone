from fastapi.testclient import TestClient

from app.config import AsrConfig
from app.audio_buffer import FrameVadDecision
from app.main import create_app
from app.routes import frame_vad_headers
import json
import struct


def test_health_route() -> None:
    client = TestClient(create_app(AsrConfig(mock_emit_every_frames=1)))

    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    fingerprint = body.pop("runtimeFingerprint")
    assert len(fingerprint) == 64
    assert body == {
        "status": "ok",
        "service": "asr-service",
        "provider": "mock",
        "modelVersion": "mock-asr-v0.1.0",
        "vadProvider": "none",
        "vadThreshold": 0.5,
        "vadConfiguredProvider": "rms",
        "vadFallbackReason": None,
        "vadModelFingerprint": None,
        "runtimeSignatureVersion": 1,
    }


def test_runtime_fingerprint_changes_with_effective_parameters() -> None:
    first = TestClient(create_app(AsrConfig(mock_emit_every_frames=1)))
    second = TestClient(create_app(AsrConfig(mock_emit_every_frames=2)))

    assert first.get("/health").json()["runtimeFingerprint"] != (
        second.get("/health").json()["runtimeFingerprint"]
    )


def test_runtime_fingerprint_tracks_mixed_language_retry() -> None:
    disabled = AsrConfig(provider="qwen3_asr")
    enabled = AsrConfig(
        provider="qwen3_asr",
        qwen3_mixed_language_retry_enabled=True,
    )

    assert disabled.runtime_parameters() != enabled.runtime_parameters()
    assert disabled.runtime_parameters()["mixedLanguageRetryEnabled"] is False
    assert enabled.runtime_parameters()["mixedLanguageRetryEnabled"] is True


def test_metrics_exposes_runtime_identity_without_secrets() -> None:
    client = TestClient(create_app(AsrConfig(
        api_key="asr-secret",
        metrics_bearer_token="metrics-secret",
    )))

    unauthorized = client.get("/metrics")
    response = client.get(
        "/metrics",
        headers={"authorization": "Bearer metrics-secret"},
    )

    assert unauthorized.status_code == 401
    assert response.status_code == 200
    assert "wujie_model_service_info" in response.text
    assert client.get("/health").json()["runtimeFingerprint"] in response.text
    assert "asr-secret" not in response.text
    assert "metrics-secret" not in response.text


def test_metrics_fails_closed_without_a_bearer_token() -> None:
    client = TestClient(create_app(AsrConfig()))

    assert client.get("/metrics").status_code == 503


def test_diagnostics_route_reports_unavailable_for_mock_engine() -> None:
    client = TestClient(create_app(AsrConfig(mock_emit_every_frames=1)))

    response = client.get("/asr/sessions/sess_1/diagnostics")

    assert response.status_code == 404


def test_transcribe_route_returns_204_before_transcript_ready() -> None:
    client = TestClient(create_app(AsrConfig(mock_emit_every_frames=8)))

    response = client.post("/asr/transcribe", json=payload(sequence=1))

    assert response.status_code == 204
    assert response.content == b""


def test_transcribe_route_returns_transcript() -> None:
    client = TestClient(create_app(AsrConfig(mock_emit_every_frames=1)))

    response = client.post("/asr/transcribe", json=payload(sequence=1))

    assert response.status_code == 200
    assert response.json()["text"] == "hello, this is a realtime translation test"
    assert response.json()["language"] == "en"


def test_frame_vad_headers_preserve_marblenet_signal() -> None:
    headers = frame_vad_headers(FrameVadDecision(
        sequence=9,
        timestamp_ms=1200,
        duration_ms=100,
        voiced=True,
        speech_probability=0.72,
        provider="marblenet",
        preroll_ms=400,
    ))

    assert headers == {
        "x-asr-vad-voiced": "true",
        "x-asr-vad-provider": "marblenet",
        "x-asr-vad-sequence": "9",
        "x-asr-vad-timestamp-ms": "1200",
        "x-asr-vad-duration-ms": "100",
        "x-asr-vad-preroll-ms": "400",
        "x-asr-vad-fallback": "false",
        "x-asr-vad-probability": "0.72",
    }


def test_transcribe_route_accepts_hotwords_and_corrections() -> None:
    client = TestClient(create_app(AsrConfig(mock_emit_every_frames=1)))
    body = payload(sequence=1)
    body["hotwords"] = ["筑基丹", "灵脉之心"]
    body["corrections"] = [{"fromText": "助机单", "toText": "筑基丹"}]

    response = client.post("/asr/transcribe", json=body)

    assert response.status_code == 200


def test_transcribe_route_requires_api_key_when_configured() -> None:
    client = TestClient(create_app(AsrConfig(
        api_key="asr-secret",
        mock_emit_every_frames=1,
    )))

    response = client.post("/asr/transcribe", json=payload(sequence=1))

    assert response.status_code == 401


def test_transcribe_route_rejects_wrong_api_key() -> None:
    client = TestClient(create_app(AsrConfig(
        api_key="asr-secret",
        mock_emit_every_frames=1,
    )))

    response = client.post(
        "/asr/transcribe",
        json=payload(sequence=1),
        headers={"authorization": "Bearer wrong"},
    )

    assert response.status_code == 403


def test_transcribe_route_accepts_configured_api_key() -> None:
    client = TestClient(create_app(AsrConfig(
        api_key="asr-secret",
        mock_emit_every_frames=1,
    )))

    response = client.post(
        "/asr/transcribe",
        json=payload(sequence=1),
        headers={"authorization": "Bearer asr-secret"},
    )

    assert response.status_code == 200


def test_flush_route_returns_204_when_no_transcript_ready() -> None:
    client = TestClient(create_app(AsrConfig(mock_emit_every_frames=8)))

    response = client.post("/asr/sessions/sess_1/flush", json=flush_payload())

    assert response.status_code == 204
    assert response.content == b""


def test_boundary_route_accepts_a_confirmed_speaker_boundary() -> None:
    client = TestClient(create_app(AsrConfig(mock_emit_every_frames=8)))

    response = client.post(
        "/asr/sessions/sess_1/boundary",
        json={**flush_payload(), "boundaryMs": 1200},
    )

    assert response.status_code == 204


def test_close_session_route_clears_session_state() -> None:
    client = TestClient(create_app(AsrConfig(mock_emit_every_frames=1)))

    first = client.post("/asr/transcribe", json=payload(sequence=1))
    closed = client.delete("/asr/sessions/sess_1")
    second = client.post("/asr/transcribe", json=payload(sequence=1))

    assert first.status_code == 200
    assert closed.status_code == 204
    assert second.status_code == 200


def test_close_session_route_requires_api_key_when_configured() -> None:
    client = TestClient(create_app(AsrConfig(api_key="asr-secret")))

    response = client.delete("/asr/sessions/sess_1")

    assert response.status_code == 401


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


def payload(sequence: int) -> dict:
    return {
        "sessionId": "sess_1",
        "sequence": sequence,
        "timestampMs": sequence,
        "format": "pcm16",
        "sampleRate": 24000,
        "data": "AA==",
        "sourceLanguage": "en",
        "targetLanguage": "zh",
    }


def flush_payload() -> dict:
    return {
        "sourceLanguage": "en",
        "targetLanguage": "zh",
    }


def stream_frame(sequence: int, request_id: str) -> bytes:
    header = json.dumps({
        "type": "audio.frame",
        "requestId": request_id,
        "sequence": sequence,
        "timestampMs": sequence * 100,
        "format": "pcm16",
        "sampleRate": 24000,
    }).encode("utf-8")
    return struct.pack(">I", len(header)) + header + b"\x00\x00"
