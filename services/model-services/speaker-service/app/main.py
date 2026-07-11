from fastapi import FastAPI

from app.config import SpeakerConfig, load_config
from app.mock_engine import MockSpeakerEngine
from app.routes import create_router
from app.sortformer_shadow_engine import SortformerShadowEngine


def create_app(config: SpeakerConfig | None = None) -> FastAPI:
    resolved = config or load_config()
    engine = create_engine(resolved)
    app = FastAPI(title="ai phone Speaker Service", version="0.1.0")
    app.include_router(create_router(engine, resolved))
    return app


def create_engine(config: SpeakerConfig):
    if config.provider == "sortformer_shadow":
        return SortformerShadowEngine(
            model_id=config.model_id,
            inference_interval_ms=config.inference_interval_ms,
            stabilization_ms=config.stabilization_ms,
            max_context_ms=config.max_context_ms,
        )
    return MockSpeakerEngine()


app = create_app()
