from dataclasses import dataclass
import os


DEFAULT_HYMT2_MODEL_DIR = (
    "/data/models/translation-model-eval/data/translation-product-fit/models/hymt2_1_8b"
)


@dataclass(frozen=True)
class TranslationConfig:
    provider: str = "mock"
    model_version: str = "tencent/Hy-MT2-1.8B"
    api_key: str = ""
    hymt2_model_dir: str = DEFAULT_HYMT2_MODEL_DIR
    hymt2_dtype: str = "bfloat16"
    hymt2_device_map: str = "auto"
    max_new_tokens: int = 4096
    temperature: float = 0.7
    top_p: float = 0.6
    top_k: int = 20
    repetition_penalty: float = 1.05


def load_config() -> TranslationConfig:
    return TranslationConfig(
        provider=os.getenv("TRANSLATION_SERVICE_PROVIDER", "mock"),
        model_version=os.getenv("TRANSLATION_MODEL_VERSION", "tencent/Hy-MT2-1.8B"),
        api_key=os.getenv("TRANSLATION_SERVICE_API_KEY", "").strip(),
        hymt2_model_dir=os.getenv("TRANSLATION_HYMT2_MODEL_DIR", DEFAULT_HYMT2_MODEL_DIR),
        hymt2_dtype=os.getenv("TRANSLATION_HYMT2_DTYPE", "bfloat16"),
        hymt2_device_map=os.getenv("TRANSLATION_HYMT2_DEVICE_MAP", "auto"),
        max_new_tokens=int(os.getenv("TRANSLATION_MAX_NEW_TOKENS", "4096")),
        temperature=float(os.getenv("TRANSLATION_TEMPERATURE", "0.7")),
        top_p=float(os.getenv("TRANSLATION_TOP_P", "0.6")),
        top_k=int(os.getenv("TRANSLATION_TOP_K", "20")),
        repetition_penalty=float(os.getenv("TRANSLATION_REPETITION_PENALTY", "1.05")),
    )
