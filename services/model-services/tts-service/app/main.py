from fastapi import FastAPI

from app.config import TtsConfig, load_config
from app.model_loader import load_engine
from app.routes import create_router
from app.service import TtsService


def create_app(config: TtsConfig | None = None) -> FastAPI:
    resolved_config = config or load_config()
    engine = load_engine(resolved_config)
    service = TtsService(engine, voice_reference_dir=resolved_config.voice_reference_dir)
    app = FastAPI(title="Translation TTS Service", version="0.1.0")
    app.include_router(create_router(service, resolved_config))
    return app


app = create_app()
