from fastapi import FastAPI

from app.config import TranslationConfig, load_config
from app.model_loader import load_engine
from app.routes import create_router
from app.runtime_observability import build_runtime_identity
from app.service import TranslationService


def create_app(config: TranslationConfig | None = None) -> FastAPI:
    resolved_config = config or load_config()
    engine = load_engine(resolved_config)
    service = TranslationService(engine, resolved_config)
    runtime_identity = build_runtime_identity(
        service="translation-service",
        provider=resolved_config.provider,
        model_version=resolved_config.model_version,
        parameters=resolved_config.runtime_parameters(),
    )
    app = FastAPI(title="Translation Model Service", version="0.1.0")
    app.include_router(create_router(service, resolved_config, runtime_identity))
    return app


app = create_app()
