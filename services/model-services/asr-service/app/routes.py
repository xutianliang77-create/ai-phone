from hmac import compare_digest

from fastapi import APIRouter, Header, HTTPException, Response, status

from app.config import AsrConfig
from app.schemas import (
    AsrBoundaryRequest,
    AsrFlushRequest,
    AsrTranscribeRequest,
    HealthResponse,
    VadDiagnosticsResponse,
)
from app.service import AsrService


def create_router(service: AsrService, config: AsrConfig) -> APIRouter:
    router = APIRouter()

    @router.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        vad_health = service.vad_health_diagnostics
        return HealthResponse(
            status="ok",
            service="asr-service",
            provider=config.provider,
            modelVersion=config.model_version,
            vadProvider=service.vad_provider_name,
            vadThreshold=config.vad_threshold,
            vadConfiguredProvider=str(vad_health["configuredProvider"]),
            vadFallbackReason=vad_health.get("fallbackReason"),
            vadModelFingerprint=vad_health.get("modelFingerprint"),
        )

    @router.get(
        "/asr/sessions/{session_id}/diagnostics",
        response_model=VadDiagnosticsResponse,
    )
    async def diagnostics(
        session_id: str,
        authorization: str | None = Header(default=None),
    ):
        require_api_key(config, authorization)
        result = service.vad_diagnostics(session_id)
        if result is None:
            raise HTTPException(status_code=404, detail="ASR diagnostics unavailable")
        return result

    @router.post("/asr/transcribe", status_code=status.HTTP_200_OK)
    async def transcribe(
        request: AsrTranscribeRequest,
        authorization: str | None = Header(default=None),
    ):
        require_api_key(config, authorization)
        transcript = await service.transcribe(request)
        if transcript is None:
            return Response(status_code=status.HTTP_204_NO_CONTENT)
        return transcript

    @router.post("/asr/sessions/{session_id}/flush", status_code=status.HTTP_200_OK)
    async def flush(
        session_id: str,
        request: AsrFlushRequest,
        authorization: str | None = Header(default=None),
    ):
        require_api_key(config, authorization)
        transcript = await service.flush(session_id, request)
        if transcript is None:
            return Response(status_code=status.HTTP_204_NO_CONTENT)
        return transcript

    @router.post(
        "/asr/sessions/{session_id}/boundary",
        status_code=status.HTTP_200_OK,
    )
    async def commit_boundary(
        session_id: str,
        request: AsrBoundaryRequest,
        authorization: str | None = Header(default=None),
    ):
        require_api_key(config, authorization)
        transcript = await service.commit_boundary(session_id, request)
        if transcript is None:
            return Response(status_code=status.HTTP_204_NO_CONTENT)
        return transcript

    @router.delete("/asr/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def close_session(
        session_id: str,
        authorization: str | None = Header(default=None),
    ):
        require_api_key(config, authorization)
        await service.close_session(session_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router


def require_api_key(config: AsrConfig, authorization: str | None) -> None:
    if not config.api_key:
        return
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing ASR service API key")
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        raise HTTPException(status_code=401, detail="Invalid ASR service auth scheme")
    if not compare_digest(authorization[len(prefix):], config.api_key):
        raise HTTPException(status_code=403, detail="Invalid ASR service API key")
