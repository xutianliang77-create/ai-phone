from __future__ import annotations

import asyncio
import base64
import os
from contextlib import asynccontextmanager

import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from candidate_service.models import LocalMossRunner, MossRunner


class RevisionRequest(BaseModel):
    audioPcm16: str


def create_worker_app(runner: MossRunner | None = None) -> FastAPI:
    holder: dict[str, MossRunner] = {}

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if runner is not None:
            holder["runner"] = runner
        else:
            local = await asyncio.to_thread(
                LocalMossRunner,
                required_env("MOSS_MODEL_PATH"),
                required_env("MOSS_SOURCE_ROOT"),
            )
            await asyncio.to_thread(local.prewarm)
            holder["runner"] = local
        yield

    app = FastAPI(title="Isolated MOSS revision worker", lifespan=lifespan)

    def authorize(authorization: str | None = Header(default=None)) -> None:
        expected = required_env("MOSS_WORKER_API_KEY")
        if authorization != f"Bearer {expected}":
            raise HTTPException(status_code=401, detail="unauthorized")

    @app.get("/health")
    async def health():
        return {
            "status": "ok" if "runner" in holder else "loading",
            "service": "moss-revision-candidate",
            "ready": "runner" in holder,
        }

    @app.post("/revision", dependencies=[Depends(authorize)])
    async def revision(request: RevisionRequest):
        try:
            raw = base64.b64decode(request.audioPcm16, validate=True)
        except ValueError as error:
            raise HTTPException(status_code=400, detail="invalid audio") from error
        if len(raw) % 2:
            raise HTTPException(status_code=400, detail="invalid pcm16 length")
        audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
        text, speaker_count = await asyncio.to_thread(
            holder["runner"].transcribe,
            audio,
        )
        return {"text": text, "speakerCount": speaker_count}

    return app


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


app = create_worker_app()
