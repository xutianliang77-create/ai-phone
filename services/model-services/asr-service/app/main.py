from contextlib import asynccontextmanager
from typing import Callable

from fastapi import FastAPI

from app.config import AsrConfig, load_config
from app.model_loader import AsrEngine, load_engine
from app.resident_runtime import ResidentAsrRuntime
from app.routes import create_router
from app.runtime_observability import build_runtime_identity
from app.service import AsrService


def create_app(
    config: AsrConfig | None = None,
    engine_loader: Callable[[AsrConfig], AsrEngine] = load_engine,
) -> FastAPI:
    resolved_config = config or load_config()
    resident_runtime: ResidentAsrRuntime | None = None
    if resolved_config.provider == "qwen3_asr_vllm":
        resident_runtime = ResidentAsrRuntime(resolved_config, engine_loader)
        service = None

        @asynccontextmanager
        async def lifespan(_app: FastAPI):
            await resident_runtime.start()
            yield
            await resident_runtime.stop()

        app = FastAPI(
            title="Translation ASR Service",
            version="0.1.0",
            lifespan=lifespan,
        )
    else:
        service = AsrService(engine_loader(resolved_config))
        app = FastAPI(title="Translation ASR Service", version="0.1.0")

    def runtime_identity():
        active_service = service
        if resident_runtime is not None:
            active_service = resident_runtime.service
        return build_service_runtime_identity(resolved_config, active_service)

    app.state.resident_asr_runtime = resident_runtime
    app.include_router(create_router(
        service,
        resolved_config,
        runtime_identity,
        resident_runtime=resident_runtime,
    ))
    return app


def build_service_runtime_identity(
    config: AsrConfig,
    service: AsrService | None,
):
    if service is None:
        active_vad_provider = "pending"
        vad_health: dict[str, object] = {
            "configuredProvider": config.vad_provider,
            "modelFingerprint": None,
        }
    else:
        active_vad_provider = service.vad_provider_name
        vad_health = service.vad_health_diagnostics
    return build_runtime_identity(
        service="asr-service",
        provider=config.provider,
        model_version=config.model_version,
        parameters={
            **config.runtime_parameters(),
            "activeVadProvider": active_vad_provider,
            "configuredVadProvider": vad_health.get("configuredProvider"),
            "vadModelFingerprint": vad_health.get("modelFingerprint"),
        },
    )


app = create_app()
