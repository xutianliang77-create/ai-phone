from hmac import compare_digest
import json

from fastapi import APIRouter, Header, HTTPException, Response, status
from fastapi.responses import StreamingResponse

from app.config import TtsConfig
from app.errors import TtsUnavailableError
from app.schemas import (
    HealthResponse,
    TtsSynthesizeRequest,
    TtsSynthesizeResponse,
    VoiceReferenceUploadRequest,
    VoiceReferenceUploadResponse,
    VoicePresetCatalogResponse,
)
from app.runtime_observability import (
    RuntimeIdentity,
    prometheus_model_metrics,
    require_metrics_token,
)
from app.service import TtsService


def create_router(
    service: TtsService,
    config: TtsConfig,
    runtime_identity: RuntimeIdentity,
) -> APIRouter:
    router = APIRouter()

    @router.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        available, reason = service.health()
        return health_response(service, config, runtime_identity, available, reason)

    @router.get("/ready", response_model=HealthResponse)
    async def ready(response: Response) -> HealthResponse:
        available, reason = service.readiness()
        if not available:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return health_response(service, config, runtime_identity, available, reason)

    @router.get("/metrics")
    async def metrics(
        authorization: str | None = Header(default=None),
    ) -> Response:
        require_metrics_token(config.metrics_bearer_token, authorization)
        available, _reason = service.readiness()
        return Response(
            content=prometheus_model_metrics(runtime_identity, available),
            media_type="text/plain; version=0.0.4",
        )

    @router.get("/voice-presets", response_model=VoicePresetCatalogResponse)
    async def voice_presets(
        authorization: str | None = Header(default=None),
    ) -> VoicePresetCatalogResponse:
        require_api_key(config, authorization)
        return service.preset_catalog()

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
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except TtsUnavailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @router.post("/tts/stream", status_code=status.HTTP_200_OK)
    async def synthesize_stream(
        request: TtsSynthesizeRequest,
        authorization: str | None = Header(default=None),
    ):
        require_api_key(config, authorization)
        try:
            stream = service.synthesize_stream(request)
            first = await anext(stream)
            return StreamingResponse(
                tts_ndjson_stream(first, stream),
                media_type="application/x-ndjson",
                headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except TtsUnavailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @router.post("/tts/warmup", status_code=status.HTTP_200_OK)
    async def warmup(
        request: TtsSynthesizeRequest,
        authorization: str | None = Header(default=None),
    ):
        require_api_key(config, authorization)
        try:
            return await service.warmup(request)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
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


def health_response(
    service: TtsService,
    config: TtsConfig,
    runtime_identity: RuntimeIdentity,
    available: bool,
    reason: str | None,
) -> HealthResponse:
    model_sample_rate, output_sample_rate = service.sample_rates()
    return HealthResponse(
        status="ok" if available else "degraded",
        service="tts-service",
        provider=config.provider,
        modelVersion=config.model_version,
        available=available,
        reason=reason,
        modelSampleRate=model_sample_rate,
        outputSampleRate=output_sample_rate,
        voicePresetCatalogVersion=service.preset_catalog().version,
        availableVoicePresetCount=len(service.preset_catalog().presets),
        runtimeSignatureVersion=runtime_identity.signature_version,
        runtimeFingerprint=runtime_identity.fingerprint,
    )


async def tts_ndjson_stream(first: dict, stream):
    try:
        yield json.dumps(first) + "\n"
        async for event in stream:
            yield json.dumps(event) + "\n"
    finally:
        await stream.aclose()


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
