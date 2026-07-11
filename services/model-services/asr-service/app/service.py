from app.model_loader import AsrEngine
from app.schemas import (
    AsrBoundaryRequest,
    AsrFlushRequest,
    AsrTranscribeRequest,
    AsrTranscribeResponse,
)


class AsrService:
    def __init__(self, engine: AsrEngine) -> None:
        self.engine = engine

    @property
    def vad_provider_name(self) -> str:
        segmenter = getattr(self.engine, "segmenter", None)
        provider = getattr(segmenter, "vad_provider", None)
        return getattr(provider, "name", "none")

    async def transcribe(
        self,
        request: AsrTranscribeRequest,
    ) -> AsrTranscribeResponse | None:
        return await self.engine.transcribe(request)

    async def flush(
        self,
        session_id: str,
        request: AsrFlushRequest,
    ) -> AsrTranscribeResponse | None:
        return await self.engine.flush(
            session_id=session_id,
            source_language=request.sourceLanguage,
            target_language=request.targetLanguage,
        )

    async def commit_boundary(
        self,
        session_id: str,
        request: AsrBoundaryRequest,
    ) -> AsrTranscribeResponse | None:
        return await self.engine.commit_boundary(
            session_id=session_id,
            boundary_ms=request.boundaryMs,
            source_language=request.sourceLanguage,
            target_language=request.targetLanguage,
        )

    async def close_session(self, session_id: str) -> None:
        await self.engine.close_session(session_id)
