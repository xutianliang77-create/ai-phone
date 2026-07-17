from dataclasses import dataclass


@dataclass(frozen=True)
class TranslationInput:
    text: str
    target_language: str
    max_tokens: int
    previous_segments: tuple[tuple[str, str], ...] = ()
    glossary: tuple[tuple[str, str], ...] = ()
    protected_entities: tuple[str, ...] = ()


class TranslationEngine:
    provider = "mock"

    def health(self) -> tuple[bool, str | None]:
        return True, None

    def translate(self, request: TranslationInput) -> str:
        raise NotImplementedError

    def translate_stream(self, request: TranslationInput):
        yield self.translate(request)
