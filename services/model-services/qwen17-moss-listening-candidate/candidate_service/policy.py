from __future__ import annotations

import re
import unicodedata
from typing import Sequence


WORD_PATTERN = re.compile(r"[^\W_]+(?:['’][^\W_]+)?", re.UNICODE)
NUMERIC_PATTERNS = (
    re.compile(r"\d+(?:[.,]\d+)?%?"),
    re.compile(r"百分之[零〇一二两三四五六七八九十百千万亿点\d]+"),
    re.compile(
        r"[零〇一二两三四五六七八九十百千万亿点\d]+"
        r"(?:到|至|-)"
        r"[零〇一二两三四五六七八九十百千万亿点\d]+"
    ),
    re.compile(
        r"[零〇一二两三四五六七八九十百千万亿点\d]+"
        r"(?:元|块|岁|年|月|日|号|人|个|倍)"
    ),
)
FIXED_LATIN_ENTITIES = frozenset({"app", "atm", "gdp", "api", "url"})
LATIN_TOKEN_PATTERN = re.compile(r"\b[A-Za-z][A-Za-z0-9._+-]*\b")
COMMON_SILENCE_HALLUCINATIONS = frozenset(
    {
        "bye",
        "hmm",
        "ok",
        "okay",
        "thanks",
        "thankyou",
        "yeah",
        "yes",
        "you",
    }
)


def normalized_word_tokens(text: str) -> list[str]:
    normalized = unicodedata.normalize("NFKC", text).casefold()
    return [match.group(0) for match in WORD_PATTERN.finditer(normalized)]


def word_matches(text: str) -> list[re.Match[str]]:
    return list(WORD_PATTERN.finditer(text))


def adjacent_duplicate_positions(tokens: Sequence[str]) -> list[int]:
    return [
        index
        for index in range(1, len(tokens))
        if tokens[index] == tokens[index - 1]
    ]


def has_adjacent_duplicate(text: str) -> bool:
    return bool(adjacent_duplicate_positions(normalized_word_tokens(text)))


def is_low_evidence_silence_hallucination(
    *,
    text: str,
    source_language: str,
    endpoint_reason: str,
    voiced_ms: float,
    max_speech_probability: float | None,
) -> bool:
    source = source_language.strip().lower().split("-", 1)[0]
    if source in {"auto", "en"}:
        return False
    if endpoint_reason not in {"silence", "flush"}:
        return False
    if voiced_ms > 250 or max_speech_probability is None:
        return False
    if max_speech_probability >= 0.5:
        return False
    normalized = "".join(
        character
        for character in unicodedata.normalize("NFKC", text).casefold()
        if character.isalnum()
    )
    return normalized in COMMON_SILENCE_HALLUCINATIONS


def protected_surfaces(text: str) -> list[str]:
    normalized = unicodedata.normalize("NFKC", text)
    values: set[str] = set()
    for pattern in NUMERIC_PATTERNS:
        values.update(
            match.group(0).casefold() for match in pattern.finditer(normalized)
        )
    for match in LATIN_TOKEN_PATTERN.finditer(normalized):
        token = match.group(0)
        folded = token.casefold()
        if (
            folded in FIXED_LATIN_ENTITIES
            or any(character.isdigit() for character in token)
            or sum(character.isupper() for character in token) >= 2
        ):
            values.add(folded)
    return sorted(values)


def contains_token_window(tokens: Sequence[str], window: Sequence[str]) -> bool:
    if not window:
        return False
    size = len(window)
    return any(
        list(tokens[index : index + size]) == list(window)
        for index in range(len(tokens) - size + 1)
    )


def surgical_duplicate_patch(
    draft_text: str,
    revision_text: str,
) -> dict[str, object] | None:
    matches = word_matches(draft_text)
    draft = [
        unicodedata.normalize("NFKC", match.group(0)).casefold()
        for match in matches
    ]
    revision = normalized_word_tokens(revision_text)
    for index in adjacent_duplicate_positions(draft):
        left = max(0, index - 2)
        right = min(len(draft), index + 2)
        single_window = draft[left:index] + draft[index + 1 : right]
        repeated_window = draft[left:right]
        if not contains_token_window(revision, single_window):
            continue
        if contains_token_window(revision, repeated_window):
            continue
        patched = (
            draft_text[: matches[index - 1].end()]
            + draft_text[matches[index].end() :]
        )
        if protected_surfaces(patched) != protected_surfaces(draft_text):
            continue
        return {
            "text": patched,
            "removedToken": draft[index],
            "removedTokenIndex": index,
            "confirmationWindow": single_window,
        }
    return None


def gate_revision(
    *,
    draft_text: str,
    revision_text: str,
    speaker_count: int,
) -> dict[str, object]:
    reasons: list[str] = []
    revision_tokens = normalized_word_tokens(revision_text)
    if not revision_tokens:
        reasons.append("blank_moss")
    if speaker_count > 1:
        reasons.append("moss_multiple_speakers")
    if not has_adjacent_duplicate(draft_text):
        reasons.append("qwen_has_no_adjacent_duplicate")

    patch = surgical_duplicate_patch(draft_text, revision_text)
    if has_adjacent_duplicate(draft_text) and patch is None:
        reasons.append("moss_did_not_confirm_single_duplicate_deletion")
    if reasons:
        patch = None
    return {
        "policy": "moss_confirmed_surgical_duplicate_patch_v2",
        "selectedLane": "surgical_duplicate_patch" if patch else "qwen17",
        "riskReasons": reasons,
        "patch": patch,
        "text": patch["text"] if patch else draft_text,
    }
