import re

from app.model_loader import AsrEngine
from app.schemas import (
    AsrBoundaryRequest,
    AsrCorrectionTerm,
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
        engine_diagnostics = getattr(self.engine, "diagnostics", None)
        if engine_diagnostics:
            return engine_diagnostics(session_id)
        segmenter = getattr(self.engine, "segmenter", None)
        diagnostics = getattr(segmenter, "diagnostics", None)
        return diagnostics(session_id) if diagnostics else None

    def frame_vad_decision(self, session_id: str):
        segmenter = getattr(self.engine, "segmenter", None)
        decision = getattr(segmenter, "frame_vad_decision", None)
        return decision(session_id) if decision else None

    @property
    def external_boundary_supported(self) -> bool:
        return callable(getattr(self.engine, "transcribe_segment", None))

    async def transcribe(
        self,
        request: AsrTranscribeRequest,
    ) -> AsrTranscribeResponse | None:
        response = await self.engine.transcribe(request)
        return corrected_response(response, request.corrections)

    async def transcribe_segment(
        self,
        request: AsrTranscribeRequest,
    ) -> AsrTranscribeResponse | None:
        transcribe_segment = getattr(self.engine, "transcribe_segment", None)
        if not callable(transcribe_segment):
            raise NotImplementedError(
                "active ASR provider does not support externally segmented audio"
            )
        response = await transcribe_segment(request)
        return corrected_response(response, request.corrections)

    async def flush(
        self,
        session_id: str,
        request: AsrFlushRequest,
    ) -> AsrTranscribeResponse | None:
        response = await self.engine.flush(
            session_id=session_id,
            source_language=request.sourceLanguage,
            target_language=request.targetLanguage,
        )
        return corrected_response(response, request.corrections)

    async def commit_boundary(
        self,
        session_id: str,
        request: AsrBoundaryRequest,
    ) -> AsrTranscribeResponse | None:
        response = await self.engine.commit_boundary(
            session_id=session_id,
            boundary_ms=request.boundaryMs,
            source_language=request.sourceLanguage,
            target_language=request.targetLanguage,
        )
        return corrected_response(response, request.corrections)

    async def close_session(self, session_id: str) -> None:
        await self.engine.close_session(session_id)


def corrected_response(
    response: AsrTranscribeResponse | None,
    corrections: list[AsrCorrectionTerm],
) -> AsrTranscribeResponse | None:
    if response is None or not corrections:
        return response
    replacements: dict[str, str] = {}
    sources: dict[str, str] = {}
    for correction in corrections:
        source = correction.fromText.strip()
        target = correction.toText.strip()
        key = source.casefold()
        if not source or not target or key in replacements:
            continue
        replacements[key] = target
        sources[key] = source
    if not replacements:
        return response
    pattern = re.compile(
        "|".join(
            re.escape(sources[key])
            for key in sorted(
                sources,
                key=lambda item: len(sources[item]),
                reverse=True,
            )
        ),
        re.IGNORECASE,
    )
    text = pattern.sub(
        lambda match: replacements[match.group(0).casefold()],
        response.text,
    )
    if text == response.text:
        return response
    return response.model_copy(update={"text": text})
