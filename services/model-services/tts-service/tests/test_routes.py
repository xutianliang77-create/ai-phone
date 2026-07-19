from fastapi.testclient import TestClient
import json

from app.config import TtsConfig
from app.main import create_app


def test_health_route_mock() -> None:
    client = TestClient(create_app(TtsConfig()))

    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    fingerprint = body.pop("runtimeFingerprint")
    assert len(fingerprint) == 64
    assert body == {
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
        "runtimeSignatureVersion": 1,
    }


def test_ready_requires_one_successful_inference() -> None:
    client = TestClient(create_app(TtsConfig()))

    before = client.get("/ready")
    warmed = client.post("/tts/warmup", json=payload())
    after = client.get("/ready")

    assert before.status_code == 503
    assert before.json()["available"] is False
    assert "inference readiness" in before.json()["reason"]
    assert warmed.status_code == 200
    assert after.status_code == 200
    assert after.json()["available"] is True


def test_metrics_exposes_runtime_identity_without_secrets() -> None:
    client = TestClient(create_app(TtsConfig(
        api_key="tts-secret",
        metrics_bearer_token="metrics-secret",
        voxcpm2_model_dir="/secret/model/path",
    )))

    assert client.get("/metrics").status_code == 401
    response = client.get(
        "/metrics",
        headers={"authorization": "Bearer metrics-secret"},
    )

    assert response.status_code == 200
    assert "wujie_model_service_up" in response.text
    assert client.get("/health").json()["runtimeFingerprint"] in response.text
    assert "tts-secret" not in response.text
    assert "metrics-secret" not in response.text
    assert "/secret/model/path" not in response.text


def test_runtime_fingerprint_changes_with_effective_parameters() -> None:
    first = TestClient(create_app(TtsConfig(mock_sample_rate=16000)))
    second = TestClient(create_app(TtsConfig(mock_sample_rate=24000)))

    assert first.get("/health").json()["runtimeFingerprint"] != (
        second.get("/health").json()["runtimeFingerprint"]
    )


def test_metrics_fails_closed_without_a_bearer_token() -> None:
    client = TestClient(create_app(TtsConfig()))

    assert client.get("/metrics").status_code == 503


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


def test_stream_route_returns_metadata_pcm_chunks_and_final() -> None:
    client = TestClient(create_app(TtsConfig()))

    response = client.post("/tts/stream", json=payload())

    messages = [json.loads(line) for line in response.text.splitlines()]
    assert response.status_code == 200
    assert messages[0]["type"] == "metadata"
    assert messages[1]["type"] == "audio_chunk"
    assert messages[1]["format"] == "pcm16"
    assert messages[-1] == {"type": "final", "audioDurationMs": 240}


def test_warmup_route_is_cached_after_first_synthesis() -> None:
    client = TestClient(create_app(TtsConfig()))

    first = client.post("/tts/warmup", json=payload())
    second = client.post("/tts/warmup", json=payload())

    assert first.status_code == 200
    assert first.json()["cached"] is False
    assert second.json()["cached"] is True
    assert second.json()["provider"] == "mock"


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
