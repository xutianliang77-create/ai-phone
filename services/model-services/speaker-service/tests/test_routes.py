import base64

from fastapi.testclient import TestClient

from app.config import SpeakerConfig
from app.main import create_app
from app.routes import speaker_service_mode


def config() -> SpeakerConfig:
    return SpeakerConfig(
        provider="mock",
        model_id="mock-speaker",
        api_key=None,
        chunk_len=6,
        chunk_left_context=1,
        chunk_right_context=7,
        fifo_len=188,
        spkcache_update_period=144,
        spkcache_len=188,
        onset=0.5,
        offset=0.5,
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
        "final": True,
    }]


def test_sortformer_provider_is_reported_as_active() -> None:
    assert speaker_service_mode("sortformer") == "active"
    assert speaker_service_mode("sortformer_shadow") == "shadow"
