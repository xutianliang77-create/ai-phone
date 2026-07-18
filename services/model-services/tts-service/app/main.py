from fastapi import FastAPI

from app.config import TtsConfig, load_config
from app.model_loader import load_engine
from app.routes import create_router
from app.runtime_observability import build_runtime_identity
from app.service import TtsService
from app.voice_preset_catalog import VoicePresetCatalog


def create_app(config: TtsConfig | None = None) -> FastAPI:
    resolved_config = config or load_config()
    engine = load_engine(resolved_config)
    voice_presets = VoicePresetCatalog.load(
        resolved_config.voice_preset_manifest_path,
        resolved_config.voice_reference_dir,
    )
    service = TtsService(
        engine,
        voice_reference_dir=resolved_config.voice_reference_dir,
        voice_presets=voice_presets,
    )
    model_sample_rate, output_sample_rate = service.sample_rates()
    runtime_identity = build_runtime_identity(
        service="tts-service",
        provider=resolved_config.provider,
        model_version=resolved_config.model_version,
        parameters={
            **resolved_config.runtime_parameters(),
            "modelSampleRate": model_sample_rate,
            "outputSampleRate": output_sample_rate,
            "voicePresetCatalogVersion": service.preset_catalog().version,
        },
    )
    app = FastAPI(title="Translation TTS Service", version="0.1.0")
    app.include_router(create_router(service, resolved_config, runtime_identity))
    return app


app = create_app()
