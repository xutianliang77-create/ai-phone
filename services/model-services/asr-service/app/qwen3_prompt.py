from app.schemas import LanguageCode


def qwen3_language(source_language: LanguageCode) -> str | None:
    if source_language in ("zh", "zh-CN", "Chinese"):
        return "Chinese"
    if source_language in ("en", "en-US", "English"):
        return "English"
    return None


def qwen3_context(
    source_language: LanguageCode,
    context: str,
    english_context: str,
    hotwords: list[str] | None = None,
    corrections: list[object] | None = None,
) -> str:
    prompt = hotword_context(hotwords or [], corrections or [])
    if source_language in ("en", "en-US", "English"):
        return join_context(english_context, prompt)
    return join_context(context, prompt)


def hotword_context(hotwords: list[str], corrections: list[object]) -> str:
    words = clean_prompt_words(hotwords)
    pairs = clean_correction_pairs(corrections)
    parts: list[str] = []
    if words:
        parts.append("优先识别并保留以下热词的准确写法：" + "、".join(words[:120]) + "。")
    if pairs:
        rendered = "；".join(f"{source}=>{target}" for source, target in pairs[:60])
        parts.append("常见误识别纠正：" + rendered + "。")
    return "\n".join(parts)


def join_context(base: str, prompt: str) -> str:
    return "\n".join(part for part in [base.strip(), prompt.strip()] if part)


def clean_prompt_words(words: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for word in words:
        value = str(word).strip()
        if not value or len(value) > 80:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result


def clean_correction_pairs(corrections: list[object]) -> list[tuple[str, str]]:
    result: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in corrections:
        source = getattr(item, "fromText", None)
        target = getattr(item, "toText", None)
        if isinstance(item, dict):
            source = item.get("fromText")
            target = item.get("toText")
        if isinstance(item, tuple) and len(item) == 2:
            source, target = item
        source_text = str(source or "").strip()
        target_text = str(target or "").strip()
        if not source_text or not target_text:
            continue
        key = (source_text.lower(), target_text.lower())
        if key in seen:
            continue
        seen.add(key)
        result.append((source_text, target_text))
    return result


def qwen3_torch_dtype(torch_module, dtype: str):
    normalized = dtype.lower()
    if normalized in ("bf16", "bfloat16"):
        return torch_module.bfloat16
    if normalized in ("fp16", "float16", "half"):
        return torch_module.float16
    if normalized in ("fp32", "float32"):
        return torch_module.float32
    raise ValueError(f"Unsupported Qwen3-ASR dtype: {dtype}")
