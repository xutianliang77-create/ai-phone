from app.config import TranslationConfig
from app.engines import TranslationEngine
from app.hymt2_engine import HyMt2Engine
from app.mock_engine import MockTranslationEngine


def load_engine(config: TranslationConfig) -> TranslationEngine:
    if config.provider in {"hymt2", "hymt2_self_hosted"}:
        return HyMt2Engine(config)
    return MockTranslationEngine()
