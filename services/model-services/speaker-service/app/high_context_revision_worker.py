from __future__ import annotations

import asyncio
import base64
from contextlib import asynccontextmanager
import hashlib
import json
import os
import time
from typing import Literal, Protocol

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from app.high_context_revision import HighContextSortformerRunner
from app.schemas import SpeakerSpan


class RevisionRunner(Protocol):
    model_id: str
    profile: dict[str, str | int | float]

    async def revise(
        self,
        pcm: bytes,
        sample_rate: int,
        frame_ms: int = 80,
    ) -> list[SpeakerSpan]: ...


class RevisionRequest(BaseModel):
    audioPcm16: str
    sessionId: str = Field(min_length=1, max_length=160)
    generation: int = Field(ge=1)
    windowStartMs: int = Field(ge=0)
    windowEndMs: int = Field(ge=1)
    sampleRate: Literal[16000, 24000]


def create_worker_app(runner: RevisionRunner | None = None) -> FastAPI:
    holder: dict[str, RevisionRunner] = {}

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        holder["runner"] = runner or await asyncio.to_thread(create_runner)
        yield

    app = FastAPI(
        title="Isolated high-context Sortformer revision worker",
        lifespan=lifespan,
    )

    def authorize(authorization: str | None = Header(default=None)) -> None:
        expected = required_env("SORTFORMER_REVISION_API_KEY")
        if authorization != f"Bearer {expected}":
            raise HTTPException(status_code=401, detail="unauthorized")

    @app.get("/health")
    async def health():
        active = holder.get("runner")
        return {
            "status": "ok" if active else "loading",
            "service": "sortformer-high-context-revision",
            "ready": active is not None,
            **({
                "runtimeProfile": active.profile,
                "profileFingerprint": profile_fingerprint(active.profile),
            } if active else {}),
        }

    @app.post("/revision", dependencies=[Depends(authorize)])
    async def revision(request: RevisionRequest):
        if request.windowEndMs <= request.windowStartMs:
            raise HTTPException(status_code=400, detail="invalid audio window")
        try:
            raw = base64.b64decode(request.audioPcm16, validate=True)
        except ValueError as error:
            raise HTTPException(status_code=400, detail="invalid audio") from error
        if len(raw) == 0 or len(raw) % 2:
            raise HTTPException(status_code=400, detail="invalid pcm16 length")
        max_seconds = bounded_int(
            "SORTFORMER_REVISION_MAX_SECONDS",
            90,
            5,
            120,
        )
        if len(raw) > request.sampleRate * 2 * max_seconds:
            raise HTTPException(status_code=413, detail="audio window too large")
        duration_ms = len(raw) * 1000 // (request.sampleRate * 2)
        expected_ms = request.windowEndMs - request.windowStartMs
        if abs(duration_ms - expected_ms) > 500:
            raise HTTPException(status_code=400, detail="audio duration mismatch")

        started = time.perf_counter()
        active = holder["runner"]
        spans = await active.revise(raw, request.sampleRate)
        speaker_ids = {span.speakerId for span in spans}
        if not spans or not speaker_ids:
            raise HTTPException(status_code=422, detail="no speaker evidence")
        return {
            "sessionId": request.sessionId,
            "generation": request.generation,
            "windowStartMs": request.windowStartMs,
            "windowEndMs": request.windowEndMs,
            "provider": "sortformer_high_context",
            "model": "diar_streaming_sortformer_4spk-v2.1",
            "speakerCount": len(speaker_ids),
            "spans": [span.model_dump(exclude_none=True) for span in spans],
            "latencyMs": (time.perf_counter() - started) * 1000,
        }

    return app


def create_runner() -> HighContextSortformerRunner:
    return HighContextSortformerRunner(
        model_id=required_env("SORTFORMER_REVISION_MODEL_ID"),
        device=os.getenv("SORTFORMER_REVISION_DEVICE", "cpu"),
        chunk_len=bounded_int("SORTFORMER_REVISION_CHUNK_LEN", 62, 6, 340),
        chunk_left_context=bounded_int(
            "SORTFORMER_REVISION_CHUNK_LEFT_CONTEXT", 1, 0, 40,
        ),
        chunk_right_context=bounded_int(
            "SORTFORMER_REVISION_CHUNK_RIGHT_CONTEXT", 1, 0, 40,
        ),
        fifo_len=bounded_int("SORTFORMER_REVISION_FIFO_LEN", 62, 0, 340),
        cache_update_period=bounded_int(
            "SORTFORMER_REVISION_CACHE_UPDATE_PERIOD", 62, 1, 340,
        ),
        cache_len=bounded_int("SORTFORMER_REVISION_CACHE_LEN", 188, 1, 1000),
        onset=bounded_float("SORTFORMER_REVISION_ONSET", 0.5),
        offset=bounded_float("SORTFORMER_REVISION_OFFSET", 0.5),
        min_duration_on_ms=bounded_int(
            "SORTFORMER_REVISION_MIN_DURATION_ON_MS", 100, 0, 5_000,
        ),
        min_duration_off_ms=bounded_int(
            "SORTFORMER_REVISION_MIN_DURATION_OFF_MS", 320, 0, 5_000,
        ),
    )


def profile_fingerprint(profile: dict[str, str | int | float]) -> str:
    canonical = json.dumps(
        profile,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def bounded_int(name: str, fallback: int, minimum: int, maximum: int) -> int:
    value = int(os.getenv(name, str(fallback)))
    if value < minimum or value > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def bounded_float(name: str, fallback: float) -> float:
    value = float(os.getenv(name, str(fallback)))
    if value < 0 or value > 1:
        raise ValueError(f"{name} must be between 0 and 1")
    return value


app = create_worker_app()
