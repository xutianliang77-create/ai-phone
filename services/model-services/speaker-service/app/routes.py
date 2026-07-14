from hmac import compare_digest

from fastapi import APIRouter, Header, HTTPException, Response, status

from app.config import SpeakerConfig
from app.engine import SpeakerEngine
from app.voice_identity import VoiceIdentityEngine
from app.schemas import (
    CreateSpeakerSessionRequest,
    HealthResponse,
    SpeakerAudioFrame,
    SpeakerSpansResponse,
    VoiceIdentityEnrollRequest,
    VoiceIdentityEnrollResponse,
    VoiceIdentityMatchRequest,
    VoiceIdentityMatchResponse,
)


def create_router(
    engine: SpeakerEngine,
    identity_engine: VoiceIdentityEngine,
    config: SpeakerConfig,
) -> APIRouter:
    router = APIRouter()

    @router.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            service="speaker-service",
            provider=config.provider,
            model=config.model_id,
            mode=speaker_service_mode(config.provider),
            voiceIdentityProvider=config.voice_identity_provider,
            voiceIdentityAvailable=identity_engine.available,
        )

    @router.post(
        "/voice-identities/{identity_id}/enroll",
        response_model=VoiceIdentityEnrollResponse,
    )
    async def enroll_voice_identity(
        identity_id: str,
        request: VoiceIdentityEnrollRequest,
        authorization: str | None = Header(default=None),
    ) -> VoiceIdentityEnrollResponse:
        require_api_key(config, authorization)
        require_voice_identity(identity_engine)
        try:
            embedding_ref = await identity_engine.enroll(identity_id, request.audioBase64)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return VoiceIdentityEnrollResponse(embeddingRef=embedding_ref)

    @router.post("/voice-identities/match", response_model=VoiceIdentityMatchResponse)
    async def match_voice_identity(
        request: VoiceIdentityMatchRequest,
        authorization: str | None = Header(default=None),
    ) -> VoiceIdentityMatchResponse:
        require_api_key(config, authorization)
        require_voice_identity(identity_engine)
        embedding_ref, confidence = await identity_engine.match(
            request.audioBase64,
            request.candidateRefs,
            request.threshold,
        )
        return VoiceIdentityMatchResponse(
            embeddingRef=embedding_ref,
            confidence=max(0.0, min(1.0, confidence)),
        )

    @router.delete("/voice-identities/{embedding_ref}", status_code=204)
    async def delete_voice_identity(
        embedding_ref: str,
        authorization: str | None = Header(default=None),
    ):
        require_api_key(config, authorization)
        require_voice_identity(identity_engine)
        await identity_engine.delete(embedding_ref)
        return Response(status_code=204)

    @router.post("/speaker/sessions", status_code=status.HTTP_204_NO_CONTENT)
    async def create_session(
        request: CreateSpeakerSessionRequest,
        authorization: str | None = Header(default=None),
    ):
        require_api_key(config, authorization)
        await engine.create_session(request)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.post("/speaker/frames", response_model=SpeakerSpansResponse)
    async def push_audio(
        frame: SpeakerAudioFrame,
        authorization: str | None = Header(default=None),
    ) -> SpeakerSpansResponse:
        require_api_key(config, authorization)
        return SpeakerSpansResponse(spans=await engine.push_audio(frame))

    @router.post(
        "/speaker/sessions/{session_id}/flush",
        response_model=SpeakerSpansResponse,
    )
    async def flush(
        session_id: str,
        authorization: str | None = Header(default=None),
    ) -> SpeakerSpansResponse:
        require_api_key(config, authorization)
        return SpeakerSpansResponse(spans=await engine.flush(session_id))

    @router.delete(
        "/speaker/sessions/{session_id}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    async def close_session(
        session_id: str,
        authorization: str | None = Header(default=None),
    ):
        require_api_key(config, authorization)
        await engine.close_session(session_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router


def speaker_service_mode(provider: str) -> str:
    if provider == "sortformer":
        return "active"
    if provider == "sortformer_shadow":
        return "shadow"
    return "contract"


def require_api_key(config: SpeakerConfig, authorization: str | None) -> None:
    if not config.api_key:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing speaker service API key")
    if not compare_digest(authorization[7:], config.api_key):
        raise HTTPException(status_code=403, detail="Invalid speaker service API key")


def require_voice_identity(engine: VoiceIdentityEngine) -> None:
    if not engine.available:
        raise HTTPException(status_code=503, detail="Voice identity provider unavailable")
