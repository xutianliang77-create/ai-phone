from hmac import compare_digest

from fastapi import APIRouter, Header, HTTPException, status

from app.config import TtsConfig
from app.errors import TtsUnavailableError
from app.schemas import (
    HealthResponse,
    TtsSynthesizeRequest,
    TtsSynthesizeResponse,
    VoiceReferenceUploadRequest,
    VoiceReferenceUploadResponse,
)
from app.service import TtsService


def create_router(service: TtsService, config: TtsConfig) -> APIRouter:
    router = APIRouter()

    @router.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        available, reason = service.health()
        return HealthResponse(
            status="ok" if available else "degraded",
            service="tts-service",
            provider=config.provider,
            modelVersion=config.model_version,
            available=available,
            reason=reason,
        )

    @router.post(
        "/tts/synthesize",
        response_model=TtsSynthesizeResponse,
        status_code=status.HTTP_200_OK,
    )
    async def synthesize(
        request: TtsSynthesizeRequest,
        authorization: str | None = Header(default=None),
    ) -> TtsSynthesizeResponse:
        require_api_key(config, authorization)
        try:
            return await service.synthesize(request)
        except TtsUnavailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @router.put(
        "/voice-references/{reference_audio_id}",
        response_model=VoiceReferenceUploadResponse,
        status_code=status.HTTP_200_OK,
    )
    async def upload_voice_reference(
        reference_audio_id: str,
        request: VoiceReferenceUploadRequest,
        authorization: str | None = Header(default=None),
    ) -> VoiceReferenceUploadResponse:
        require_api_key(config, authorization)
        try:
            return service.save_voice_reference_audio(
                reference_audio_id,
                request.audioBase64,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except TtsUnavailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    return router


def require_api_key(config: TtsConfig, authorization: str | None) -> None:
    if not config.api_key:
        return
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Missing TTS service API key",
            headers={"WWW-Authenticate": "Bearer"},
        )
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        raise HTTPException(status_code=401, detail="Invalid TTS service auth scheme")
    token = authorization[len(prefix):]
    if not compare_digest(token, config.api_key):
        raise HTTPException(status_code=403, detail="Invalid TTS service API key")
