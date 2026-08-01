import base64
from dataclasses import replace
import io
import wave

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


class FakeSessionAliasEngine:
    available = True

    def __init__(self) -> None:
        self.sessions: set[str] = set()

    async def create_session(self, session_id: str) -> None:
        self.sessions.add(session_id)

    async def observe(
        self,
        session_id: str,
        raw_speaker_id: str,
        audio_base64: str,
        overlap: bool,
    ):
        assert session_id in self.sessions
        assert raw_speaker_id == "speaker_2"
        assert audio_base64
        assert overlap is False
        return type("Observation", (), {
            "rawSpeakerId": raw_speaker_id,
            "evidenceMs": 1600,
            "eligible": True,
            "similarities": {"speaker_1": 0.6326},
        })()

    async def close_session(self, session_id: str) -> None:
        self.sessions.discard(session_id)


def test_session_alias_contract_is_scoped_to_speaker_session() -> None:
    alias_engine = FakeSessionAliasEngine()
    app = FastAPI()
    app.include_router(create_router(
        create_engine(config()),
        FakeVoiceIdentityEngine(),
        config(),
        alias_engine,
    ))
    client = TestClient(app)

    created = client.post("/speaker/sessions", json={
        "sessionId": "sess_1",
        "options": {"mode": "diarization", "maxSpeakers": 2},
    })
    observed = client.post(
        "/speaker/sessions/sess_1/aliases/observe",
        json={
            "rawSpeakerId": "speaker_2",
            "audioBase64": wav_base64(1600),
            "overlap": False,
        },
    )
    closed = client.delete("/speaker/sessions/sess_1")

    assert created.status_code == 204
    assert observed.json() == {
        "rawSpeakerId": "speaker_2",
        "evidenceMs": 1600,
        "eligible": True,
        "similarities": {"speaker_1": 0.6326},
    }
    assert closed.status_code == 204
    assert alias_engine.sessions == set()


def test_session_alias_contract_reports_disabled_provider() -> None:
    client = TestClient(create_app(config()))
    client.post("/speaker/sessions", json={
        "sessionId": "sess_1",
        "options": {"mode": "diarization", "maxSpeakers": 2},
    })

    response = client.post(
        "/speaker/sessions/sess_1/aliases/observe",
        json={
            "rawSpeakerId": "speaker_2",
            "audioBase64": wav_base64(1600),
            "overlap": False,
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"] == (
        "Session speaker alias provider unavailable"
    )


def wav_base64(duration_ms: int) -> str:
    output = io.BytesIO()
    with wave.open(output, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(16000)
        handle.writeframes(b"\x00\x00" * (16 * duration_ms))
    return base64.b64encode(output.getvalue()).decode()
