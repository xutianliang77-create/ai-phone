from hmac import compare_digest
import base64
import json

from fastapi import APIRouter, Header, HTTPException, status
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
from app.service import TtsService


def create_router(service: TtsService, config: TtsConfig) -> APIRouter:
    router = APIRouter()

    @router.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        available, reason = service.health()
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
            speech = await service.synthesize(request)
            return StreamingResponse(
                tts_ndjson_stream(speech),
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


async def tts_ndjson_stream(speech: TtsSynthesizeResponse):
    body = speech.model_dump(exclude={"audio"}, exclude_none=True)
    yield json.dumps({"type": "metadata", **body}) + "\n"
    pcm = base64.b64decode(speech.audio.data)
    bytes_per_chunk = max(2, int(speech.audio.sampleRate * 2 * 0.1))
    for offset in range(0, len(pcm), bytes_per_chunk):
        chunk = pcm[offset:offset + bytes_per_chunk]
        yield json.dumps({
            "type": "audio_chunk",
            "format": "pcm16",
            "sampleRate": speech.audio.sampleRate,
            "sequence": offset // bytes_per_chunk + 1,
            "data": base64.b64encode(chunk).decode("ascii"),
        }) + "\n"
    yield json.dumps({"type": "final"}) + "\n"


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
