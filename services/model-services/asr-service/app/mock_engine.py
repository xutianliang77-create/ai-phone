from app.schemas import LanguageCode, TranslationLanguageCode
from app.schemas import AsrTranscribeRequest, AsrTranscribeResponse


class MockAsrEngine:
    def __init__(self, emit_every_frames: int = 8) -> None:
        self.emit_every_frames = emit_every_frames
        self._seen_sequences: dict[str, set[int]] = {}

    async def transcribe(
        self,
        request: AsrTranscribeRequest,
    ) -> AsrTranscribeResponse | None:
        seen = self._seen_sequences.setdefault(request.sessionId, set())
        if request.sequence in seen:
            return None
        seen.add(request.sequence)
        if request.sequence % self.emit_every_frames != 0:
            return None

        language = transcript_language(request)
        text = (
            "hello, this is a realtime translation test"
            if language == "en"
            else "你好，这是一次实时翻译测试。"
        )
        return AsrTranscribeResponse(
            segmentId=f"asr_seg_{request.sequence}",
            text=text,
            language=language,
            confidence=0.9,
        )

    async def flush(
        self,
        session_id: str,
        source_language: LanguageCode,
        target_language: TranslationLanguageCode,
    ) -> AsrTranscribeResponse | None:
        return None

    async def close_session(self, session_id: str) -> None:
        self._seen_sequences.pop(session_id, None)


def transcript_language(request: AsrTranscribeRequest) -> str:
    if request.sourceLanguage in ("zh", "en"):
        return request.sourceLanguage
    return "en" if request.targetLanguage == "zh" else "zh"
