from hmac import compare_digest

from fastapi import APIRouter, Header, HTTPException, Response, status

from app.config import SpeakerConfig
from app.engine import SpeakerEngine
from app.schemas import (
    CreateSpeakerSessionRequest,
    HealthResponse,
    SpeakerAudioFrame,
    SpeakerSpansResponse,
)


def create_router(engine: SpeakerEngine, config: SpeakerConfig) -> APIRouter:
    router = APIRouter()

    @router.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            service="speaker-service",
            provider=config.provider,
            model=config.model_id,
            mode="shadow" if config.provider == "sortformer_shadow" else "contract",
        )

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


def require_api_key(config: SpeakerConfig, authorization: str | None) -> None:
    if not config.api_key:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing speaker service API key")
    if not compare_digest(authorization[7:], config.api_key):
        raise HTTPException(status_code=403, detail="Invalid speaker service API key")
