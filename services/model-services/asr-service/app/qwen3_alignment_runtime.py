from __future__ import annotations

import asyncio
import logging

from app.qwen3_forced_aligner import TranscriptForcedAligner
from app.qwen3_prompt import qwen3_language
from app.sensevoice_engine import transcript_language


LOGGER = logging.getLogger(__name__)


async def align_final_tokens(
    aligner: TranscriptForcedAligner | None,
    audio_path: str,
    text: str,
    source_language: str,
    target_language: str,
    start_ms: int,
    end_ms: int,
    session_id: str,
) -> list[dict[str, object]] | None:
    if aligner is None or not text:
        return None
    detected = transcript_language(text, source_language, target_language)
    language = qwen3_language(source_language) or qwen3_language(detected)
    try:
        tokens = await asyncio.to_thread(
            aligner.align,
            audio_path,
            text,
            language,
        )
    except Exception:
        LOGGER.exception(
            "Qwen forced alignment failed; returning segment timing only",
            extra={"sessionId": session_id},
        )
        return None
    payload = []
    for token in tokens:
        absolute_start = start_ms + token.start_ms
        unbounded_end = start_ms + token.end_ms
        if (
            absolute_start < start_ms or
            absolute_start > end_ms or
            unbounded_end < absolute_start or
            unbounded_end > end_ms + 250
        ):
            LOGGER.warning(
                "Qwen forced alignment exceeded its segment window",
                extra={"sessionId": session_id},
            )
            return None
        absolute_end = min(unbounded_end, end_ms)
        payload.append({
            "text": token.text,
            "startMs": absolute_start,
            "endMs": absolute_end,
            **(
                {"confidence": token.confidence}
                if token.confidence is not None else {}
            ),
            **(
                {
                    "characterStart": token.character_start,
                    "characterEnd": token.character_end,
                }
                if token.character_start is not None and
                token.character_end is not None else {}
            ),
        })
    return payload
