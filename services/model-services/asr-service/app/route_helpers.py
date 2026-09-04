from hmac import compare_digest
import json
import struct

from fastapi import HTTPException

from app.audio_buffer import FrameVadDecision
from app.config import AsrConfig
from app.resident_runtime import ResidentAsrRuntime, RuntimeUnavailable
from app.service import AsrService


async def require_ready_service(
    service: AsrService | None,
    resident_runtime: ResidentAsrRuntime | None,
) -> AsrService:
    if resident_runtime is None:
        if service is None:
            raise HTTPException(status_code=503, detail="ASR service unavailable")
        return service
    try:
        return await resident_runtime.ready_service()
    except RuntimeUnavailable as exc:
        raise runtime_http_error(exc) from None


async def admit_service(
    service: AsrService | None,
    resident_runtime: ResidentAsrRuntime | None,
    session_id: str,
) -> AsrService:
    if resident_runtime is None:
        if service is None:
            raise HTTPException(status_code=503, detail="ASR service unavailable")
        return service
    try:
        return await resident_runtime.admit(session_id)
    except RuntimeUnavailable as exc:
        raise runtime_http_error(exc) from None


def runtime_http_error(exc: RuntimeUnavailable) -> HTTPException:
    return HTTPException(
        status_code=exc.status_code,
        detail={
            "code": exc.code,
            "state": exc.state,
            "generation": exc.generation,
        },
    )


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
