from fastapi.testclient import TestClient

from app.config import AsrConfig
from app.main import create_app


def test_health_route() -> None:
    client = TestClient(create_app(AsrConfig(mock_emit_every_frames=1)))

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "asr-service",
        "provider": "mock",
        "modelVersion": "mock-asr-v0.1.0",
        "vadProvider": "none",
        "vadThreshold": 0.5,
    }


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
