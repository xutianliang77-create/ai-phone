from dataclasses import dataclass


@dataclass(frozen=True)
class TranslationInput:
    text: str
    target_language: str
    max_tokens: int


class TranslationEngine:
    provider = "mock"

    def health(self) -> tuple[bool, str | None]:
        return True, None

    def translate(self, request: TranslationInput) -> str:
        raise NotImplementedError
