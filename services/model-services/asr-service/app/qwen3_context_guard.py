from difflib import SequenceMatcher

from app.sensevoice_engine import normalize_transcript


def is_context_echo(text: str, context: str) -> bool:
    mapping_count = sum(text.count(marker) for marker in ("=>", "->", "→"))
    if mapping_count >= 2:
        return True

    normalized_text = normalize_transcript(text)
    if len(normalized_text) < 16:
        return False

    control_prefixes = (
        normalize_transcript("优先识别并保留以下热词的准确写法"),
        normalize_transcript("常见误识别纠正"),
    )
    if normalized_text.startswith(control_prefixes):
        return True

    normalized_context = normalize_transcript(context)
    if len(normalized_context) < 24:
        return False
    if normalized_text in normalized_context:
        return True

    match = SequenceMatcher(
        None,
        normalized_text,
        normalized_context,
        autojunk=False,
    ).find_longest_match()
    return len(normalized_text) >= 24 and match.size / len(normalized_text) >= 0.8
