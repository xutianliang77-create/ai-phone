from hmac import compare_digest

import base64
import json
import struct

from fastapi import APIRouter, Header, HTTPException, Response, WebSocket, status
from pydantic import ValidationError

from app.config import AsrConfig
from app.audio_buffer import FrameVadDecision
from app.schemas import (
    AsrBoundaryRequest,
    AsrFlushRequest,
    AsrTranscribeRequest,
    HealthResponse,
    VadDiagnosticsResponse,
)
from app.runtime_observability import (
    RuntimeIdentity,
    prometheus_model_metrics,
    require_metrics_token,
)
from app.service import AsrService


def create_router(
    service: AsrService,
    config: AsrConfig,
    runtime_identity: RuntimeIdentity,
) -> APIRouter:
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
            runtimeSignatureVersion=runtime_identity.signature_version,
            runtimeFingerprint=runtime_identity.fingerprint,
        )

    @router.get("/metrics")
    async def metrics(
        authorization: str | None = Header(default=None),
    ) -> Response:
        require_metrics_token(config.metrics_bearer_token, authorization)
        return Response(
            content=prometheus_model_metrics(runtime_identity, True),
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
        result = service.vad_diagnostics(session_id)
        if result is None:
            raise HTTPException(status_code=404, detail="ASR diagnostics unavailable")
        return result

    @router.post("/asr/transcribe", status_code=status.HTTP_200_OK)
    async def transcribe(
        request: AsrTranscribeRequest,
        response: Response,
        authorization: str | None = Header(default=None),
    ):
        require_api_key(config, authorization)
        transcript = await service.transcribe(request)
        headers = frame_vad_headers(service.frame_vad_decision(request.sessionId))
        if transcript is None:
            return Response(
                status_code=status.HTTP_204_NO_CONTENT,
                headers=headers,
            )
        response.headers.update(headers)
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

    @router.websocket("/asr/stream")
    async def stream(websocket: WebSocket):
        await websocket.accept()
        session_id: str | None = None
        stream_config: dict | None = None
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
                    transcript = await service.transcribe(request)
                    decision = service.frame_vad_decision(session_id)
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
                    transcript = await service.flush(
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
                    await service.close_session(session_id)
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


def valid_stream_api_key(config: AsrConfig, api_key: object) -> bool:
    if not config.api_key:
        return True
    return isinstance(api_key, str) and compare_digest(api_key, config.api_key)


def decode_audio_frame(payload: bytes) -> tuple[dict, bytes]:
    if len(payload) < 5:
        raise ValueError("ASR stream frame is too short")
    header_size = struct.unpack(">I", payload[:4])[0]
    if header_size <= 0 or header_size > 16 * 1024:
        raise ValueError("ASR stream header size is invalid")
    header_end = 4 + header_size
    if header_end >= len(payload):
        raise ValueError("ASR stream PCM payload is empty")
    if len(payload) - header_end > 1024 * 1024:
        raise ValueError("ASR stream PCM payload is too large")
    header = json.loads(payload[4:header_end].decode("utf-8"))
    if header.get("type") != "audio.frame":
        raise ValueError("ASR stream binary message must be audio.frame")
    request_id = header.get("requestId")
    if not isinstance(request_id, str) or not request_id or len(request_id) > 160:
        raise ValueError("ASR stream requestId is invalid")
    return header, payload[header_end:]


def stream_vad_decision(decision: FrameVadDecision | None) -> dict | None:
    if decision is None:
        return None
    return {
        "sequence": decision.sequence,
        "timestampMs": decision.timestamp_ms,
        "durationMs": decision.duration_ms,
        "voiced": decision.voiced,
        "probability": decision.speech_probability,
        "provider": decision.provider,
        "fallback": decision.provider == "rms_fallback",
        "preRollMs": decision.preroll_ms,
    }


def frame_vad_headers(decision: FrameVadDecision | None) -> dict[str, str]:
    if decision is None:
        return {}
    headers = {
        "x-asr-vad-voiced": "true" if decision.voiced else "false",
        "x-asr-vad-provider": decision.provider,
        "x-asr-vad-sequence": str(decision.sequence),
        "x-asr-vad-timestamp-ms": str(decision.timestamp_ms),
        "x-asr-vad-duration-ms": str(decision.duration_ms),
        "x-asr-vad-preroll-ms": str(decision.preroll_ms),
        "x-asr-vad-fallback": (
            "true" if decision.provider == "rms_fallback" else "false"
        ),
    }
    if decision.speech_probability is not None:
        headers["x-asr-vad-probability"] = str(decision.speech_probability)
    return headers
