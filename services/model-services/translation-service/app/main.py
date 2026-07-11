from fastapi import FastAPI

from app.config import TranslationConfig, load_config
from app.model_loader import load_engine
from app.routes import create_router
from app.service import TranslationService


def create_app(config: TranslationConfig | None = None) -> FastAPI:
    resolved_config = config or load_config()
    engine = load_engine(resolved_config)
    service = TranslationService(engine, resolved_config)
    app = FastAPI(title="Translation Model Service", version="0.1.0")
    app.include_router(create_router(service, resolved_config))
    return app


app = create_app()
