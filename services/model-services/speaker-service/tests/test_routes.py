import base64
from dataclasses import replace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import SpeakerConfig
from app.main import create_app, create_engine
from app.routes import create_router, speaker_service_mode


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


class FakeVoiceIdentityEngine:
    available = True

    def __init__(self) -> None:
        self.deleted: list[str] = []

    async def enroll(self, identity_id: str, audio_base64: str) -> str:
        assert audio_base64 == "d2F2"
        return f"ref_{identity_id}"

    async def match(
        self,
        audio_base64: str,
        candidate_refs: list[str],
        threshold: float,
    ) -> tuple[str | None, float]:
        assert audio_base64 == "d2F2"
        assert candidate_refs == ["ref_person_1"]
        assert threshold == 0.8
        return "ref_person_1", 0.91

    async def delete(self, embedding_ref: str) -> None:
        self.deleted.append(embedding_ref)


def test_voice_identity_contract_requires_key_and_supports_lifecycle() -> None:
    resolved = replace(config(), api_key="secret")
    identity = FakeVoiceIdentityEngine()
    app = FastAPI()
    app.include_router(create_router(create_engine(resolved), identity, resolved))
    client = TestClient(app)

    unauthorized = client.post(
        "/voice-identities/person_1/enroll",
        json={"audioBase64": "d2F2"},
    )
    enrolled = client.post(
        "/voice-identities/person_1/enroll",
        headers={"Authorization": "Bearer secret"},
        json={"audioBase64": "d2F2"},
    )
    matched = client.post(
        "/voice-identities/match",
        headers={"Authorization": "Bearer secret"},
        json={
            "audioBase64": "d2F2",
            "candidateRefs": ["ref_person_1"],
            "threshold": 0.8,
        },
    )
    deleted = client.delete(
        "/voice-identities/ref_person_1",
        headers={"Authorization": "Bearer secret"},
    )

    assert unauthorized.status_code == 401
    assert enrolled.json() == {"embeddingRef": "ref_person_1"}
    assert matched.json() == {
        "embeddingRef": "ref_person_1",
        "confidence": 0.91,
    }
    assert deleted.status_code == 204
    assert identity.deleted == ["ref_person_1"]


def test_voice_identity_contract_reports_unavailable_provider() -> None:
    client = TestClient(create_app(config()))

    response = client.post(
        "/voice-identities/person_1/enroll",
        json={"audioBase64": "d2F2"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "Voice identity provider unavailable"
