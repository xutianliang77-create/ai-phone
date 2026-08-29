import base64
import json
from typing import Callable

from fastapi import APIRouter, Header, HTTPException, Response, WebSocket, status
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.config import AsrConfig
from app.schemas import (
    AsrBoundaryRequest,
    AsrFlushRequest,
    AsrTranscribeRequest,
    AsrTranscribeResponse,
    HealthResponse,
    VadDiagnosticsResponse,
)
from app.runtime_observability import (
    RuntimeIdentity,
    prometheus_model_metrics,
    require_metrics_token,
)
from app.resident_runtime import ResidentAsrRuntime, RuntimeUnavailable
from app.route_helpers import (
    admit_service,
    decode_audio_frame,
    frame_vad_headers,
    require_api_key,
    require_ready_service,
    runtime_http_error,
    stream_vad_decision,
    valid_stream_api_key,
)
from app.service import AsrService


def create_router(
    service: AsrService | None,
    config: AsrConfig,
    runtime_identity: Callable[[], RuntimeIdentity],
    resident_runtime: ResidentAsrRuntime | None = None,
) -> APIRouter:
    router = APIRouter()

    @router.get("/health")
    async def health():
        if resident_runtime is not None and not resident_runtime.is_ready:
            return JSONResponse(
                status_code=503,
                content={
                    "status": "unavailable",
                    "service": "asr-service",
                    "provider": config.provider,
                    "modelVersion": config.model_version,
                    **resident_runtime.snapshot(),
                },
            )
        active_service = await require_ready_service(service, resident_runtime)
        vad_health = active_service.vad_health_diagnostics
        identity = runtime_identity()
        return HealthResponse(
            status="ok",
            service="asr-service",
            provider=config.provider,
            modelVersion=config.model_version,
            vadProvider=active_service.vad_provider_name,
            vadThreshold=config.vad_threshold,
            vadConfiguredProvider=str(vad_health["configuredProvider"]),
            vadFallbackReason=vad_health.get("fallbackReason"),
            vadModelFingerprint=vad_health.get("modelFingerprint"),
            externalBoundarySupported=active_service.external_boundary_supported,
            runtimeSignatureVersion=identity.signature_version,
            runtimeFingerprint=identity.fingerprint,
        )

    @router.get("/ready")
    async def ready():
        if resident_runtime is None:
            return {
                "state": "ready",
                "ready": True,
                "generation": 0,
                "errorCode": None,
                "activeSessions": 0,
                "maxActiveSessions": None,
                "readyWallMs": 0.0,
            }
        snapshot = resident_runtime.snapshot()
        return JSONResponse(
            status_code=200 if resident_runtime.is_ready else 503,
            content=snapshot,
        )

    @router.get("/metrics")
    async def metrics(
        authorization: str | None = Header(default=None),
    ) -> Response:
        require_metrics_token(config.metrics_bearer_token, authorization)
        return Response(
            content=prometheus_model_metrics(
                runtime_identity(),
                resident_runtime is None or resident_runtime.is_ready,
            ),
            media_type="text/plain; version=0.0.4",
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
        active_service = await require_ready_service(service, resident_runtime)
        result = active_service.vad_diagnostics(session_id)
        if result is None:
            raise HTTPException(status_code=404, detail="ASR diagnostics unavailable")
        return result

    @router.post(
        "/asr/transcribe",
        status_code=status.HTTP_200_OK,
        response_model=AsrTranscribeResponse,
        response_model_exclude_none=True,
    )
    async def transcribe(
        request: AsrTranscribeRequest,
        response: Response,
        authorization: str | None = Header(default=None),
    ):
        require_api_key(config, authorization)
        active_service = await admit_service(
            service,
            resident_runtime,
            request.sessionId,
        )
        transcript = await active_service.transcribe(request)
        headers = frame_vad_headers(
            active_service.frame_vad_decision(request.sessionId)
        )
        if transcript is None:
            return Response(
                status_code=status.HTTP_204_NO_CONTENT,
                headers=headers,
            )
        response.headers.update(headers)
        return transcript

    @router.post(
        "/asr/transcribe-segment",
        status_code=status.HTTP_200_OK,
        response_model=AsrTranscribeResponse,
        response_model_exclude_none=True,
    )
    async def transcribe_segment(
        request: AsrTranscribeRequest,
        authorization: str | None = Header(default=None),
    ):
        """Transcribe one complete segment whose boundary came from the device."""

        require_api_key(config, authorization)
        active_service = await admit_service(
            service,
            resident_runtime,
            request.sessionId,
        )
        try:
            transcript = await active_service.transcribe_segment(request)
        except NotImplementedError as exc:
            raise HTTPException(status_code=501, detail=str(exc)) from exc
        if transcript is None:
            return Response(status_code=status.HTTP_204_NO_CONTENT)
        return transcript

    @router.post(
        "/asr/sessions/{session_id}/flush",
        status_code=status.HTTP_200_OK,
        response_model=AsrTranscribeResponse,
        response_model_exclude_none=True,
    )
    async def flush(
        session_id: str,
        request: AsrFlushRequest,
        authorization: str | None = Header(default=None),
    ):
        require_api_key(config, authorization)
        active_service = await admit_service(service, resident_runtime, session_id)
        transcript = await active_service.flush(session_id, request)
        if transcript is None:
            return Response(status_code=status.HTTP_204_NO_CONTENT)
        return transcript

    @router.post(
        "/asr/sessions/{session_id}/boundary",
        status_code=status.HTTP_200_OK,
        response_model=AsrTranscribeResponse,
        response_model_exclude_none=True,
    )
    async def commit_boundary(
        session_id: str,
        request: AsrBoundaryRequest,
        authorization: str | None = Header(default=None),
    ):
        require_api_key(config, authorization)
        active_service = await admit_service(service, resident_runtime, session_id)
        transcript = await active_service.commit_boundary(session_id, request)
        if transcript is None:
            return Response(status_code=status.HTTP_204_NO_CONTENT)
        return transcript

    @router.delete("/asr/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def close_session(
        session_id: str,
        authorization: str | None = Header(default=None),
    ):
        require_api_key(config, authorization)
        active_service = await require_ready_service(service, resident_runtime)
        try:
            await active_service.close_session(session_id)
        finally:
            if resident_runtime is not None:
                await resident_runtime.release(session_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.websocket("/asr/stream")
    async def stream(websocket: WebSocket):
        await websocket.accept()
        session_id: str | None = None
        stream_config: dict | None = None
        stream_service: AsrService | None = None
        admitted = False
        try:
            opened = await websocket.receive_json()
            if opened.get("type") != "session.open":
                await websocket.close(code=4400, reason="session.open required")
                return
            if not valid_stream_api_key(config, opened.get("apiKey")):
                await websocket.close(code=4403, reason="invalid ASR service API key")
                return
            session_id = str(opened.get("sessionId") or "").strip()
            if not session_id or len(session_id) > 160:
                await websocket.close(code=4400, reason="sessionId required")
                return
            stream_config = {
                "sourceLanguage": opened.get("sourceLanguage", "auto"),
                "targetLanguage": opened.get("targetLanguage", "zh"),
                "mode": opened.get("mode", "call_link"),
                "hotwords": opened.get("hotwords", []),
                "corrections": opened.get("corrections", []),
            }
            AsrFlushRequest.model_validate(stream_config)
            if resident_runtime is not None:
                try:
                    stream_service = await resident_runtime.admit(session_id)
                    admitted = True
                except RuntimeUnavailable as exc:
                    await websocket.close(
                        code=1013 if exc.status_code == 503 else 4429,
                        reason=exc.code,
                    )
                    return
            else:
                stream_service = service
            if stream_service is None:
                await websocket.close(code=1013, reason="asr_not_started")
                return
            await websocket.send_json({
                "type": "session.ready",
                "sessionId": session_id,
            })
            while True:
                message = await websocket.receive()
                if message.get("type") == "websocket.disconnect":
                    return
                if message.get("bytes") is not None:
                    header, pcm = decode_audio_frame(message["bytes"])
                    request = AsrTranscribeRequest.model_validate({
                        **stream_config,
                        **header,
                        "sessionId": session_id,
                        "data": base64.b64encode(pcm).decode("ascii"),
                    })
                    transcript = await stream_service.transcribe(request)
                    decision = stream_service.frame_vad_decision(session_id)
                    await websocket.send_json({
                        "type": "asr.result",
                        "requestId": header.get("requestId"),
                        "sequence": request.sequence,
                        "transcript": (
                            transcript.model_dump(exclude_none=True)
                            if transcript else None
                        ),
                        "vadDecision": stream_vad_decision(decision),
                    })
                    continue
                command = json.loads(message.get("text") or "{}")
                request_id = command.get("requestId")
                if command.get("type") == "session.flush":
                    transcript = await stream_service.flush(
                        session_id,
                        AsrFlushRequest.model_validate(stream_config),
                    )
                    await websocket.send_json({
                        "type": "session.flushed",
                        "requestId": request_id,
                        "transcript": (
                            transcript.model_dump(exclude_none=True)
                            if transcript else None
                        ),
                    })
                    continue
                if command.get("type") == "session.close":
                    await stream_service.close_session(session_id)
                    await websocket.send_json({
                        "type": "session.closed",
                        "requestId": request_id,
                    })
                    await websocket.close(code=1000)
                    return
                await websocket.close(code=4400, reason="unsupported ASR stream message")
                return
        except (ValueError, KeyError, json.JSONDecodeError, ValidationError) as exc:
            await websocket.close(code=4400, reason=str(exc)[:120])
        finally:
            if admitted and session_id is not None and resident_runtime is not None:
                if stream_service is not None:
                    await stream_service.close_session(session_id)
                await resident_runtime.release(session_id)

    return router
