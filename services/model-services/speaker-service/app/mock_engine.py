from app.schemas import CreateSpeakerSessionRequest, SpeakerAudioFrame, SpeakerSpan


class MockSpeakerEngine:
    def __init__(self) -> None:
        self._sessions: set[str] = set()

    async def create_session(self, request: CreateSpeakerSessionRequest) -> None:
        self._sessions.add(request.sessionId)

    async def push_audio(self, frame: SpeakerAudioFrame) -> list[SpeakerSpan]:
        if frame.sessionId not in self._sessions:
            raise KeyError("speaker session not found")
        if frame.sequence % 8:
            return []
        speaker_index = 1 + (frame.sequence // 8) % 2
        return [SpeakerSpan(
            speakerId=f"speaker_{speaker_index}",
            startMs=frame.timestampMs,
            endMs=frame.timestampMs + 320,
            confidence=0.95,
        )]

    async def flush(self, session_id: str) -> list[SpeakerSpan]:
        if session_id not in self._sessions:
            raise KeyError("speaker session not found")
        return []

    async def close_session(self, session_id: str) -> None:
        self._sessions.discard(session_id)
