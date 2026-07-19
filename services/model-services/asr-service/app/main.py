from fastapi import FastAPI

from app.config import AsrConfig, load_config
from app.model_loader import load_engine
from app.routes import create_router
from app.runtime_observability import build_runtime_identity
from app.service import AsrService


def create_app(config: AsrConfig | None = None) -> FastAPI:
    resolved_config = config or load_config()
    engine = load_engine(resolved_config)
    service = AsrService(engine)
    vad_health = service.vad_health_diagnostics
    runtime_identity = build_runtime_identity(
        service="asr-service",
        provider=resolved_config.provider,
        model_version=resolved_config.model_version,
        parameters={
            **resolved_config.runtime_parameters(),
            "activeVadProvider": service.vad_provider_name,
            "configuredVadProvider": vad_health.get("configuredProvider"),
            "vadModelFingerprint": vad_health.get("modelFingerprint"),
        },
    )
    app = FastAPI(title="Translation ASR Service", version="0.1.0")
    app.include_router(create_router(service, resolved_config, runtime_identity))
    return app


app = create_app()
