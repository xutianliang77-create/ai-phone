from app.model_loader import AsrEngine
from app.schemas import AsrFlushRequest, AsrTranscribeRequest, AsrTranscribeResponse


class AsrService:
    def __init__(self, engine: AsrEngine) -> None:
        self.engine = engine

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

    async def close_session(self, session_id: str) -> None:
        await self.engine.close_session(session_id)
