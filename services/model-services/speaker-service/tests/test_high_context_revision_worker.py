import base64

from fastapi.testclient import TestClient

from app.high_context_revision_worker import create_worker_app
from app.schemas import SpeakerSpan


class FakeRunner:
    model_id = "sortformer-test.nemo"
    profile = {
        "provider": "sortformer_high_context",
        "model": model_id,
        "device": "cpu",
        "chunkLen": 62,
    }

    async def revise(
        self,
        pcm: bytes,
        sample_rate: int,
        frame_ms: int = 80,
    ) -> list[SpeakerSpan]:
        assert len(pcm) == 19_200
        assert sample_rate == 16_000
        assert frame_ms == 80
        return [
            SpeakerSpan(
                speakerId="speaker_1",
                startMs=0,
                endMs=300,
                confidence=0.9,
                final=True,
            ),
            SpeakerSpan(
                speakerId="speaker_2",
                startMs=300,
                endMs=600,
                confidence=0.8,
                final=True,
            ),
        ]


def test_revision_contract_and_profile_fingerprint(monkeypatch) -> None:
    monkeypatch.setenv("SORTFORMER_REVISION_API_KEY", "test-revision-key")
    with TestClient(create_worker_app(FakeRunner())) as client:
        health = client.get("/health")
        unauthorized = client.post("/revision", json=request_payload())
        response = client.post(
            "/revision",
            headers={"Authorization": "Bearer test-revision-key"},
            json=request_payload(),
        )

    assert health.status_code == 200
    assert health.json()["runtimeProfile"]["chunkLen"] == 62
    assert len(health.json()["profileFingerprint"]) == 64
    assert unauthorized.status_code == 401
    assert response.status_code == 200
    assert response.json() == {
        "sessionId": "sess_1",
        "generation": 2,
        "windowStartMs": 1_000,
        "windowEndMs": 1_600,
        "provider": "sortformer_high_context",
        "model": "diar_streaming_sortformer_4spk-v2.1",
        "speakerCount": 2,
        "spans": [
            {
                "speakerId": "speaker_1",
                "startMs": 0,
                "endMs": 300,
                "confidence": 0.9,
                "overlap": False,
                "final": True,
            },
            {
                "speakerId": "speaker_2",
                "startMs": 300,
                "endMs": 600,
                "confidence": 0.8,
                "overlap": False,
                "final": True,
            },
        ],
        "latencyMs": response.json()["latencyMs"],
    }
    assert response.json()["latencyMs"] >= 0


def test_revision_rejects_audio_timeline_mismatch(monkeypatch) -> None:
    monkeypatch.setenv("SORTFORMER_REVISION_API_KEY", "test-revision-key")
    payload = request_payload()
    payload["windowEndMs"] = 5_000
    with TestClient(create_worker_app(FakeRunner())) as client:
        response = client.post(
            "/revision",
            headers={"Authorization": "Bearer test-revision-key"},
            json=payload,
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "audio duration mismatch"


def request_payload() -> dict[str, object]:
    return {
        "sessionId": "sess_1",
        "generation": 2,
        "windowStartMs": 1_000,
        "windowEndMs": 1_600,
        "sampleRate": 16_000,
        "audioPcm16": base64.b64encode(b"\x00\x00" * 9_600).decode(),
    }
