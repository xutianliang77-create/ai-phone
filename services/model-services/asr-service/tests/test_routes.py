from fastapi.testclient import TestClient
import pytest

from app.config import AsrConfig
from app.audio_buffer import FrameVadDecision
from app.endpoint_policy import EndpointPolicy
from app.main import create_app
from app.model_loader import qwen3_endpoint_policies
from app.routes import frame_vad_headers
from tests.route_test_support import flush_payload, payload


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
        "externalBoundarySupported": True,
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


def test_vllm_runtime_parameters_are_explicit_and_fingerprinted() -> None:
    parameters = AsrConfig(provider="qwen3_asr_vllm").runtime_parameters()

    assert parameters["gpuMemoryUtilization"] == 0.35
    assert parameters["maxModelLen"] == 8192
    assert parameters["maxNumSeqs"] == 1
    assert parameters["enforceEager"] is True
    assert parameters["unfixedChunkNum"] == 7
    assert parameters["unfixedTokenNum"] == 5
    assert parameters["startupTimeoutMs"] == 30000
    assert parameters["maxActiveSessions"] == 1
def test_realtime_endpoint_defaults_keep_fast_and_listening_modes_distinct() -> None:
    config = AsrConfig(provider="qwen3_asr")

    minimums = config.runtime_parameters()["minAudioByMode"]
    assert minimums == {
        "conversation": 1000,
        "listening": 1800,
        "call_link": 1800,
        "pstn": 1800,
    }
    policies = config.runtime_parameters()["endpointSilenceByMode"]
    assert policies == {
        "conversation": 600,
        "listening": 1400,
        "call_link": 600,
        "pstn": 1100,
    }
    assert config.runtime_parameters()["minVoicedByMode"] == {
        "conversation": 0,
        "listening": 0,
        "call_link": 240,
        "pstn": 240,
    }
    endpoint_policies = qwen3_endpoint_policies(config)
    assert endpoint_policies["conversation"].min_audio_ms == 1000
    assert endpoint_policies["conversation"].endpoint_silence_ms == 600
    assert endpoint_policies["listening"].min_audio_ms == 1800
    assert endpoint_policies["call_link"].min_audio_ms == 1800
    assert endpoint_policies["pstn"].min_audio_ms == 1800
    assert endpoint_policies["call_link"].min_voiced_ms == 240
    assert endpoint_policies["pstn"].min_voiced_ms == 240


def test_negative_minimum_voiced_duration_is_rejected() -> None:
    with pytest.raises(ValueError, match="minimum voiced duration"):
        qwen3_endpoint_policies(
            AsrConfig(provider="qwen3_asr", qwen3_call_link_min_voiced_ms=-1)
        )


def test_listening_vad_threshold_does_not_change_other_modes() -> None:
    config = AsrConfig(
        provider="qwen3_asr",
        vad_threshold=0.5,
        qwen3_listening_vad_threshold=0.05,
    )

    assert config.runtime_parameters()["vadThresholdByMode"] == {
        "conversation": 0.5,
        "listening": 0.05,
        "call_link": 0.5,
        "pstn": 0.5,
    }
    policies = qwen3_endpoint_policies(config)
    assert policies["listening"].vad_threshold == 0.05
    assert policies["conversation"].vad_threshold == 0.5
    assert policies["call_link"].vad_threshold == 0.5
    assert policies["pstn"].vad_threshold == 0.5
    assert policies["listening"].fingerprint != EndpointPolicy(
        "listening", 1800, 1400, 10000, 400, 0.5
    ).fingerprint


def test_listening_max_audio_does_not_change_other_modes() -> None:
    config = AsrConfig(
        provider="qwen3_asr",
        qwen3_max_audio_ms=10000,
        qwen3_listening_max_audio_ms=6000,
    )

    assert config.runtime_parameters()["maxAudioByMode"] == {
        "conversation": 10000,
        "listening": 6000,
        "call_link": 10000,
        "pstn": 10000,
    }
    policies = qwen3_endpoint_policies(config)
    assert policies["listening"].max_audio_ms == 6000
    assert policies["conversation"].max_audio_ms == 10000
    assert policies["call_link"].max_audio_ms == 10000
    assert policies["pstn"].max_audio_ms == 10000


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


def test_external_segment_route_marks_device_boundary_and_skips_frame_vad() -> None:
    client = TestClient(create_app(AsrConfig(mock_emit_every_frames=8)))

    response = client.post("/asr/transcribe-segment", json=payload(sequence=1))

    assert response.status_code == 200
    assert response.json()["endpointReason"] == "device_vad"
    assert response.json()["vadContext"] == {
        "provider": "external",
        "source": "esp32-afe-v1",
    }
    assert "x-asr-vad-provider" not in response.headers


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


def test_external_segment_route_requires_api_key_when_configured() -> None:
    client = TestClient(create_app(AsrConfig(
        api_key="asr-secret",
        mock_emit_every_frames=1,
    )))

    response = client.post("/asr/transcribe-segment", json=payload(sequence=1))

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
