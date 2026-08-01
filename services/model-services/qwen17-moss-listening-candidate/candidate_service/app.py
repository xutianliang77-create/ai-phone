from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Response
from pydantic import BaseModel, Field

from candidate_service.factory import create_local_engine
from candidate_service.runtime import CandidateEngine


class TranscribeRequest(BaseModel):
    sessionId: str = Field(min_length=1)
    sequence: int = Field(ge=1)
    timestampMs: int = Field(ge=0)
    format: Literal["pcm16"]
    sampleRate: Literal[16000, 24000]
    data: str
    sourceLanguage: str
    targetLanguage: str
    mode: Literal["conversation", "listening", "call_link", "pstn"] = "conversation"


class FlushRequest(BaseModel):
    sourceLanguage: str
    targetLanguage: str
    mode: Literal["conversation", "listening", "call_link", "pstn"] = "conversation"


class BoundaryRequest(FlushRequest):
    boundaryMs: int = Field(ge=0)


def create_app(engine: CandidateEngine | None = None) -> FastAPI:
    holder: dict[str, CandidateEngine] = {}

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        holder["engine"] = engine or await asyncio.to_thread(create_local_engine)
        yield
        holder["engine"].shutdown()

    app = FastAPI(
        title="Qwen 1.7 + MOSS listening candidate",
        lifespan=lifespan,
    )

    def runtime() -> CandidateEngine:
        value = holder.get("engine")
        if value is None:
            raise HTTPException(status_code=503, detail="candidate is loading")
        return value

    def authorize(authorization: str | None = Header(default=None)) -> None:
        expected = os.getenv("ASR_SERVICE_API_KEY", "")
        if expected and authorization != f"Bearer {expected}":
            raise HTTPException(status_code=401, detail="unauthorized")

    @app.get("/health")
    async def health():
        current = holder.get("engine")
        ready = current is not None
        return {
            "status": "ok" if ready else "loading",
            "service": "qwen17-moss-listening-candidate",
            "provider": "qwen3-asr-1.7b-vllm",
            "revisionPolicy": "moss_confirmed_surgical_duplicate_patch_v2",
            "ready": ready,
            **({"vad": current.vad.health_diagnostics()} if current else {}),
            **(
                {
                    "diagnosticCapture":
                        current.diagnostic_capture.diagnostics()
                }
                if current
                else {}
            ),
        }

    @app.get("/candidate/status", dependencies=[Depends(authorize)])
    async def status(current: CandidateEngine = Depends(runtime)):
        return current.status()

    @app.post("/asr/transcribe", dependencies=[Depends(authorize)])
    async def transcribe(
        request: TranscribeRequest,
        current: CandidateEngine = Depends(runtime),
    ):
        if request.mode != "listening":
            raise HTTPException(
                status_code=409,
                detail="candidate only accepts listening mode",
            )
        try:
            result = await asyncio.to_thread(
                current.process_frame,
                request.model_dump(),
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        return result if result is not None else Response(status_code=204)

    @app.post(
        "/asr/sessions/{session_id}/flush",
        dependencies=[Depends(authorize)],
    )
    async def flush(
        session_id: str,
        request: FlushRequest,
        current: CandidateEngine = Depends(runtime),
    ):
        result = await asyncio.to_thread(
            current.flush,
            session_id,
            request.sourceLanguage,
        )
        return result if result is not None else Response(status_code=204)

    @app.post(
        "/asr/sessions/{session_id}/boundary",
        dependencies=[Depends(authorize)],
    )
    async def boundary(
        session_id: str,
        request: BoundaryRequest,
        current: CandidateEngine = Depends(runtime),
    ):
        result = await asyncio.to_thread(
            current.commit_boundary,
            session_id,
            request.sourceLanguage,
            request.boundaryMs,
        )
        return result if result is not None else Response(status_code=204)

    @app.get(
        "/asr/sessions/{session_id}/diagnostics",
        dependencies=[Depends(authorize)],
    )
    async def diagnostics(
        session_id: str,
        current: CandidateEngine = Depends(runtime),
    ):
        return current.diagnostics(session_id)

    @app.delete(
        "/asr/sessions/{session_id}",
        dependencies=[Depends(authorize)],
        status_code=204,
    )
    async def close_session(
        session_id: str,
        current: CandidateEngine = Depends(runtime),
    ):
        current.close_session(session_id)
        return Response(status_code=204)

    return app


app = create_app()
