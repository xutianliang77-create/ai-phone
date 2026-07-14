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

    @property
    def vad_health_diagnostics(self) -> dict[str, object]:
        segmenter = getattr(self.engine, "segmenter", None)
        provider = getattr(segmenter, "vad_provider", None)
        health = getattr(provider, "health_diagnostics", None)
        return health() if health else {
            "configuredProvider": "rms",
            "activeProvider": "rms",
            "threshold": 0.0,
        }

    def vad_diagnostics(self, session_id: str) -> dict[str, object] | None:
        segmenter = getattr(self.engine, "segmenter", None)
        diagnostics = getattr(segmenter, "diagnostics", None)
        return diagnostics(session_id) if diagnostics else None

    def frame_vad_decision(self, session_id: str):
        segmenter = getattr(self.engine, "segmenter", None)
        decision = getattr(segmenter, "frame_vad_decision", None)
        return decision(session_id) if decision else None

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
