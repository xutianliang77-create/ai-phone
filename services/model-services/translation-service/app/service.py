import re

from app.config import TranslationConfig
from app.engines import TranslationEngine, TranslationInput
from app.schemas import ChatCompletionRequest


class TranslationService:
    def __init__(self, engine: TranslationEngine, config: TranslationConfig):
        self.engine = engine
        self.config = config

    def health(self) -> tuple[bool, str | None]:
        return self.engine.health()

    def translate_chat(self, request: ChatCompletionRequest) -> str:
        return self.engine.translate(self.translation_input(request))

    def translate_chat_stream(self, request: ChatCompletionRequest):
        return self.engine.translate_stream(self.translation_input(request))

    def translation_input(self, request: ChatCompletionRequest) -> TranslationInput:
        target_language = target_language_from_messages(request)
        source_text = source_text_from_messages(request)
        max_tokens = request.max_tokens or self.config.max_new_tokens
        if not source_text:
            raise ValueError("empty source text")
        return TranslationInput(
            text=source_text,
            target_language=target_language,
            max_tokens=max_tokens,
            previous_segments=tagged_pairs(request, "READ_ONLY_CONTEXT"),
            glossary=tagged_pairs(request, "GLOSSARY"),
            protected_entities=tagged_lines(request, "PROTECTED_ENTITIES"),
        )


def source_text_from_messages(request: ChatCompletionRequest) -> str:
    users = [message.content for message in request.messages if message.role == "user"]
    text = users[-1].strip() if users else ""
    match = re.search(r"SOURCE_TEXT\s*(.*?)\s*END_SOURCE_TEXT", text, re.S)
    return (match.group(1) if match else text).strip()


def tagged_pairs(
    request: ChatCompletionRequest,
    tag: str,
) -> tuple[tuple[str, str], ...]:
    pairs: list[tuple[str, str]] = []
    for line in tagged_lines(request, tag):
        source, separator, target = line.partition("=>")
        if separator and source.strip() and target.strip():
            pairs.append((source.strip()[:200], target.strip()[:200]))
    return tuple(pairs[:24])


def tagged_lines(request: ChatCompletionRequest, tag: str) -> tuple[str, ...]:
    users = [message.content for message in request.messages if message.role == "user"]
    text = users[-1] if users else ""
    match = re.search(
        rf"{re.escape(tag)}\s*(.*?)\s*END_{re.escape(tag)}",
        text,
        re.S,
    )
    if not match:
        return ()
    return tuple(
        line.strip()[:200]
        for line in match.group(1).splitlines()
        if line.strip()
    )[:32]


def target_language_from_messages(request: ChatCompletionRequest) -> str:
    system_text = "\n".join(
        message.content for message in request.messages if message.role == "system"
    )
    detected = detect_explicit_target_language(system_text)
    if detected is not None:
        return detected

    detected = detect_target_language(system_text)
    if detected is not None:
        return detected

    joined = "\n".join(message.content for message in request.messages)
    detected = detect_explicit_target_language(joined)
    if detected is not None:
        return detected

    detected = detect_target_language(joined)
    if detected is not None:
        return detected
    return "en" if has_chinese(source_text_from_messages(request)) else "zh"


def has_chinese(value: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in value)


def detect_target_language(text: str) -> str | None:
    if not text.strip():
        return None
    lowered = text.lower()
    for code, aliases in LANGUAGE_ALIASES:
        for alias in sorted(aliases, key=len, reverse=True):
            if alias.lower() in lowered:
                return code
    return None


def detect_explicit_target_language(text: str) -> str | None:
    if not text.strip():
        return None
    lowered = text.lower()
    for code, aliases in LANGUAGE_ALIASES:
        for alias in sorted(aliases, key=len, reverse=True):
            escaped = re.escape(alias.lower())
            patterns = (
                rf"(?:翻译成|翻译为|译成|译为)\s*{escaped}",
                rf"\b(?:into|to)\s+{escaped}\b",
            )
            if any(re.search(pattern, lowered) for pattern in patterns):
                return code
    return None


LANGUAGE_ALIASES = (
    ("zh-Hant", ("Traditional Chinese", "繁体中文", "繁體中文")),
    ("zh", ("Simplified Chinese", "Chinese", "简体中文", "中文")),
    ("en", ("English", "英文", "英语")),
    ("fr", ("French", "法语")),
    ("pt", ("Portuguese", "葡萄牙语")),
    ("es", ("Spanish", "西班牙语")),
    ("ja", ("Japanese", "日语")),
    ("tr", ("Turkish", "土耳其语")),
    ("ru", ("Russian", "俄语")),
    ("ar", ("Arabic", "阿拉伯语")),
    ("ko", ("Korean", "韩语")),
    ("th", ("Thai", "泰语")),
    ("it", ("Italian", "意大利语")),
    ("de", ("German", "德语")),
    ("vi", ("Vietnamese", "越南语")),
    ("ms", ("Malay", "马来语")),
    ("id", ("Indonesian", "印尼语")),
    ("tl", ("Filipino", "菲律宾语")),
    ("hi", ("Hindi", "印地语")),
    ("pl", ("Polish", "波兰语")),
    ("cs", ("Czech", "捷克语")),
    ("nl", ("Dutch", "荷兰语")),
    ("km", ("Khmer", "高棉语")),
    ("my", ("Burmese", "缅甸语")),
    ("fa", ("Persian", "波斯语")),
    ("gu", ("Gujarati", "古吉拉特语")),
    ("ur", ("Urdu", "乌尔都语")),
    ("te", ("Telugu", "泰卢固语")),
    ("mr", ("Marathi", "马拉地语")),
    ("he", ("Hebrew", "希伯来语")),
    ("bn", ("Bengali", "孟加拉语")),
    ("ta", ("Tamil", "泰米尔语")),
    ("uk", ("Ukrainian", "乌克兰语")),
    ("bo", ("Tibetan", "藏语")),
    ("kk", ("Kazakh", "哈萨克语")),
    ("mn", ("Mongolian", "蒙古语")),
    ("ug", ("Uyghur", "维吾尔语")),
    ("yue", ("Cantonese", "粤语")),
)
