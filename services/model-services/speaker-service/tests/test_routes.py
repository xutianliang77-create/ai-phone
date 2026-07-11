import base64

from fastapi.testclient import TestClient

from app.config import SpeakerConfig
from app.main import create_app


def config() -> SpeakerConfig:
    return SpeakerConfig(
        provider="mock",
        model_id="mock-speaker",
        api_key=None,
        inference_interval_ms=2240,
        stabilization_ms=800,
        max_context_ms=120000,
    )


def test_mock_contract_emits_timed_anonymous_speaker() -> None:
    client = TestClient(create_app(config()))
    created = client.post("/speaker/sessions", json={
        "sessionId": "sess_1",
        "options": {"mode": "diarization", "maxSpeakers": 2},
    })
    response = client.post("/speaker/frames", json={
        "type": "audio.frame",
        "sessionId": "sess_1",
        "sequence": 8,
        "timestampMs": 1000,
        "format": "pcm16",
        "sampleRate": 24000,
        "data": base64.b64encode(b"\x00\x00" * 100).decode(),
    })

    assert created.status_code == 204
    assert response.status_code == 200
    assert response.json()["spans"] == [{
        "speakerId": "speaker_2",
        "startMs": 1000,
        "endMs": 1320,
        "confidence": 0.95,
        "overlap": False,
    }]
