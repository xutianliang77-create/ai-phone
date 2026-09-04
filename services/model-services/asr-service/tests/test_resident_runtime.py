import threading
import time

from fastapi.testclient import TestClient

from app.config import AsrConfig
from app.main import create_app
from app.mock_engine import MockAsrEngine


class FakeResidentEngine(MockAsrEngine):
    def __init__(self) -> None:
        super().__init__(emit_every_frames=8)
        self.prewarm_calls = 0
        self.shutdown_calls = 0

    def prewarm(self) -> None:
        self.prewarm_calls += 1

    def shutdown(self) -> None:
        self.shutdown_calls += 1


def config(**kwargs) -> AsrConfig:
    return AsrConfig(
        provider="qwen3_asr_vllm",
        model_version="Qwen3-ASR-1.7B-vLLM",
        qwen3_startup_timeout_ms=1000,
        qwen3_max_active_sessions=1,
        **kwargs,
    )


def wait_ready(client: TestClient) -> dict:
    deadline = time.monotonic() + 1
    while time.monotonic() < deadline:
        response = client.get("/ready")
        if response.status_code == 200:
            return response.json()
        time.sleep(0.01)
    raise AssertionError("resident runtime did not become ready")


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


def test_resident_runtime_rejects_requests_until_warmup_finishes() -> None:
    release_load = threading.Event()
    engine = FakeResidentEngine()

    def loader(_config):
        release_load.wait(timeout=1)
        return engine

    with TestClient(create_app(config(), engine_loader=loader)) as client:
        try:
            health = client.get("/health")
            rejected = client.post("/asr/transcribe", json=payload(sequence=1))

            assert health.status_code == 503
            assert health.json()["state"] == "loading"
            assert rejected.status_code == 503
            assert rejected.json()["detail"]["code"] == "asr_loading"
        finally:
            release_load.set()
        ready = wait_ready(client)
        assert ready["state"] == "ready"
        assert engine.prewarm_calls == 1

    assert engine.shutdown_calls == 1


def test_resident_runtime_enforces_single_active_session() -> None:
    engine = FakeResidentEngine()
    with TestClient(
        create_app(config(), engine_loader=lambda _config: engine)
    ) as client:
        wait_ready(client)

        first = client.post("/asr/transcribe", json=payload(sequence=1))
        second_body = payload(sequence=1)
        second_body["sessionId"] = "sess_2"
        second = client.post("/asr/transcribe", json=second_body)

        assert first.status_code == 204
        assert second.status_code == 429
        assert second.json()["detail"]["code"] == "asr_capacity_exceeded"

        assert client.delete("/asr/sessions/sess_1").status_code == 204
        assert client.post("/asr/transcribe", json=second_body).status_code == 204


def test_resident_runtime_reports_sanitized_load_failure() -> None:
    def loader(_config):
        raise RuntimeError("secret checkpoint path must not escape")

    with TestClient(create_app(config(), engine_loader=loader)) as client:
        deadline = time.monotonic() + 1
        response = client.get("/health")
        while response.json()["state"] != "failed" and time.monotonic() < deadline:
            time.sleep(0.01)
            response = client.get("/health")

        assert response.status_code == 503
        assert response.json()["errorCode"] == "asr_model_load_failed"
        assert "secret checkpoint" not in response.text
