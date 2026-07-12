from fastapi.testclient import TestClient

from app.config import TtsConfig
from app.main import create_app


def test_health_route_mock() -> None:
    client = TestClient(create_app(TtsConfig()))

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "tts-service",
        "provider": "mock",
        "modelVersion": "mock-tts-v0.1.0",
        "available": True,
        "reason": None,
        "modelSampleRate": 16000,
        "outputSampleRate": 16000,
        "voicePresetCatalogVersion": "unconfigured",
        "availableVoicePresetCount": 0,
    }


def test_synthesize_route_returns_tts_contract() -> None:
    client = TestClient(create_app(TtsConfig()))

    response = client.post("/tts/synthesize", json=payload())

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "mock"
    assert body["model"] == "mock-tts-v0.1.0"
    assert body["firstAudioMs"] >= 0
    assert body["modelSampleRate"] == 16000
    assert body["outputSampleRate"] == 16000
    assert body["audio"]["format"] == "pcm16"
    assert body["audio"]["sampleRate"] == 16000
    assert body["audio"]["data"]


def test_synthesize_route_accepts_voice_design_contract() -> None:
    client = TestClient(create_app(TtsConfig()))

    response = client.post("/tts/synthesize", json={
        **payload(),
        "voice": {
            "mode": "voice_design",
            "voiceProfileId": "warm_zh_001",
            "controlPrompt": "warm, clear, natural phone translation voice",
        },
    })

    assert response.status_code == 200
    body = response.json()
    assert body["voiceMode"] == "voice_design"
    assert body["voiceProfileId"] == "warm_zh_001"


def test_synthesize_route_rejects_clone_without_reference_audio() -> None:
    client = TestClient(create_app(TtsConfig()))

    response = client.post("/tts/synthesize", json={
        **payload(),
        "voice": {
            "mode": "personal_clone",
            "voiceProfileId": "my_voice",
        },
    })

    assert response.status_code == 422


def test_synthesize_route_requires_api_key_when_configured() -> None:
    client = TestClient(create_app(TtsConfig(api_key="local-tts-service-secret")))

    response = client.post("/tts/synthesize", json=payload())

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing TTS service API key"


def test_synthesize_route_rejects_wrong_api_key() -> None:
    client = TestClient(create_app(TtsConfig(api_key="local-tts-service-secret")))

    response = client.post(
        "/tts/synthesize",
        json=payload(),
        headers={"authorization": "Bearer wrong-secret"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Invalid TTS service API key"


def test_synthesize_route_accepts_configured_api_key() -> None:
    client = TestClient(create_app(TtsConfig(api_key="local-tts-service-secret")))

    response = client.post(
        "/tts/synthesize",
        json=payload(),
        headers={"authorization": "Bearer local-tts-service-secret"},
    )

    assert response.status_code == 200
    assert response.json()["provider"] == "mock"


def test_upload_voice_reference_stores_wav(tmp_path) -> None:
    client = TestClient(create_app(TtsConfig(
        api_key="local-tts-service-secret",
        voice_reference_dir=str(tmp_path),
    )))

    response = client.put(
        "/voice-references/my_voice",
        json={"audioBase64": "UklGRgAAAABXQVZFAA=="},
        headers={"authorization": "Bearer local-tts-service-secret"},
    )

    assert response.status_code == 200
    assert response.json()["referenceAudioId"] == "my_voice"
    assert (tmp_path / "my_voice.wav").read_bytes() == b"RIFF\x00\x00\x00\x00WAVE\x00"


def test_upload_voice_reference_rejects_invalid_audio(tmp_path) -> None:
    client = TestClient(create_app(TtsConfig(
        api_key="local-tts-service-secret",
        voice_reference_dir=str(tmp_path),
    )))

    response = client.put(
        "/voice-references/my_voice",
        json={"audioBase64": "bm90LXdhdg=="},
        headers={"authorization": "Bearer local-tts-service-secret"},
    )

    assert response.status_code == 400


def test_voxcpm2_health_degrades_when_runtime_is_missing(tmp_path) -> None:
    client = TestClient(create_app(TtsConfig(
        provider="voxcpm2",
        model_version="VoxCPM2",
        voxcpm2_model_dir=str(tmp_path / "missing"),
    )))

    health = client.get("/health")
    synthesize = client.post("/tts/synthesize", json=payload())

    assert health.status_code == 200
    assert health.json()["status"] == "degraded"
    assert health.json()["available"] is False
    assert "model dir does not exist" in health.json()["reason"]
    assert synthesize.status_code == 503


def payload() -> dict:
    return {
        "text": "Hello",
        "language": "en",
        "speakerRole": "guest",
        "segmentId": "seg_1",
    }
