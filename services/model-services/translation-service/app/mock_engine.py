from app.engines import TranslationEngine, TranslationInput


class MockTranslationEngine(TranslationEngine):
    provider = "mock"

    def translate(self, request: TranslationInput) -> str:
        text = request.text.strip()
        if request.target_language == "zh":
            if "hello" in text.lower():
                return "你好，这是一次服务端翻译测试。"
            return text if has_chinese(text) else "这是译文。"
        if request.target_language == "ja":
            return "これは翻訳です。"
        if request.target_language == "fr":
            return "Ceci est une traduction."
        if has_chinese(text):
            if "图纸" in text:
                return "I will send you the drawings later."
            return "This is the translation."
        return text


def has_chinese(value: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in value)
