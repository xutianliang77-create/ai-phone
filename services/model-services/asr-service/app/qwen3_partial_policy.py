import unicodedata


IGNORED_DISCOURSE_FILLERS = frozenset({"啊", "呃", "嗯", "哦"})


def confirmed_readable_prefix(
    previous: str,
    current: str,
    minimum_units: int,
) -> str | None:
    if not previous or not current:
        return None
    index = 0
    limit = min(len(previous), len(current))
    while index < limit and previous[index] == current[index]:
        index += 1
    prefix = current[:index].rstrip()
    return prefix if len(normalized_content(prefix)) >= minimum_units else None


def normalized_content(text: str) -> str:
    return "".join(
        character
        for character in str(text or "")
        if unicodedata.category(character)[:1] in {"L", "N"}
        and character not in IGNORED_DISCOURSE_FILLERS
    )


def is_chinese_partial(source_language: str, model_language: str) -> bool:
    source = source_language.strip().lower().replace("_", "-")
    if source != "auto":
        return True
    detected = str(model_language or "").strip().lower().replace("_", "-")
    return detected in {"zh", "zh-cn", "chinese"}


def language_evidence(model_language: str) -> str:
    detected = str(model_language or "").strip().lower().replace("_", "-")
    if not detected:
        return "empty"
    parts = {
        part.strip()
        for part in detected.replace(";", ",").split(",")
        if part.strip()
    }
    chinese = {"zh", "zh-cn", "chinese"}
    english = {"en", "en-us", "en-gb", "english"}
    if parts and parts <= chinese:
        return "zh"
    if parts and parts <= english:
        return "en"
    if parts and parts <= chinese | english and parts & chinese and parts & english:
        return "zh_en"
    return "other"
