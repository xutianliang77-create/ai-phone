import asyncio
import logging
import re
from collections.abc import Callable

from app.qwen3_context_guard import is_context_echo
from app.schemas import LanguageCode


logger = logging.getLogger(__name__)
Transcribe = Callable[[str, str | None, str], str]


async def retry_mixed_language_prefix(
    transcribe: Transcribe,
    audio_path: str,
    source_language: LanguageCode,
    primary_text: str,
    retry_context: str,
) -> str:
    if not should_retry_mixed_language(source_language, primary_text):
        return primary_text
    try:
        candidate = await asyncio.to_thread(
            transcribe,
            audio_path,
            "English",
            retry_context,
        )
    except Exception:
        logger.warning(
            "Qwen3 mixed-language candidate retry failed",
            exc_info=True,
        )
        return primary_text
    if is_context_echo(candidate, retry_context):
        return primary_text
    return select_mixed_language_candidate(primary_text, candidate)


def should_retry_mixed_language(
    source_language: LanguageCode,
    primary_text: str,
) -> bool:
    return (
        source_language.strip().lower() == "auto"
        and len(_han_characters(primary_text)) >= 2
        and not _latin_words(primary_text)
    )


def select_mixed_language_candidate(primary_text: str, candidate_text: str) -> str:
    primary = primary_text.strip()
    candidate = candidate_text.strip()
    primary_compact = _compact_comparison_text(primary)
    candidate_compact = _compact_comparison_text(candidate)
    latin_words = _latin_words(candidate)

    if not primary_compact or not candidate_compact.endswith(primary_compact):
        return primary
    if _han_characters(candidate) != _han_characters(primary):
        return primary
    if not 2 <= len(latin_words) <= 12:
        return primary

    prefix_length = len(candidate_compact) - len(primary_compact)
    if prefix_length <= 0 or prefix_length > 48:
        return primary
    if len(candidate_compact) > max(24, len(primary_compact) * 4):
        return primary
    return candidate


def _han_characters(text: str) -> str:
    return "".join(re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff]", text))


def _latin_words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z]+(?:['’\-][A-Za-z]+)?", text)


def _compact_comparison_text(text: str) -> str:
    return "".join(character.lower() for character in text if character.isalnum())
