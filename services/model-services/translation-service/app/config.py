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
    metrics_bearer_token: str = ""
    hymt2_model_dir: str = DEFAULT_HYMT2_MODEL_DIR
    hymt2_dtype: str = "bfloat16"
    hymt2_device_map: str = "auto"
    max_new_tokens: int = 4096
    temperature: float = 0.7
    top_p: float = 0.6
    top_k: int = 20
    repetition_penalty: float = 1.05
    max_concurrency: int = 1
    max_queue_size: int = 64
    queue_timeout_ms: int = 2000
    micro_batch_size: int = 4
    micro_batch_window_ms: int = 8

    def runtime_parameters(self) -> dict[str, object]:
        parameters: dict[str, object] = {
            "maxConcurrency": self.max_concurrency,
            "maxQueueSize": self.max_queue_size,
            "queueTimeoutMs": self.queue_timeout_ms,
            "microBatchSize": self.micro_batch_size,
            "microBatchWindowMs": self.micro_batch_window_ms,
        }
        if self.provider not in {"hymt2", "hymt2_self_hosted"}:
            return {"engine": "mock", **parameters}
        return {
            **parameters,
            "dtype": self.hymt2_dtype,
            "deviceMap": self.hymt2_device_map,
            "maxNewTokens": self.max_new_tokens,
            "temperature": self.temperature,
            "topP": self.top_p,
            "topK": self.top_k,
            "repetitionPenalty": self.repetition_penalty,
        }


def load_config() -> TranslationConfig:
    return TranslationConfig(
        provider=os.getenv("TRANSLATION_SERVICE_PROVIDER", "mock"),
        model_version=os.getenv("TRANSLATION_MODEL_VERSION", "tencent/Hy-MT2-1.8B"),
        api_key=os.getenv("TRANSLATION_SERVICE_API_KEY", "").strip(),
        metrics_bearer_token=os.getenv("METRICS_BEARER_TOKEN", "").strip(),
        hymt2_model_dir=os.getenv("TRANSLATION_HYMT2_MODEL_DIR", DEFAULT_HYMT2_MODEL_DIR),
        hymt2_dtype=os.getenv("TRANSLATION_HYMT2_DTYPE", "bfloat16"),
        hymt2_device_map=os.getenv("TRANSLATION_HYMT2_DEVICE_MAP", "auto"),
        max_new_tokens=int(os.getenv("TRANSLATION_MAX_NEW_TOKENS", "4096")),
        temperature=float(os.getenv("TRANSLATION_TEMPERATURE", "0.7")),
        top_p=float(os.getenv("TRANSLATION_TOP_P", "0.6")),
        top_k=int(os.getenv("TRANSLATION_TOP_K", "20")),
        repetition_penalty=float(os.getenv("TRANSLATION_REPETITION_PENALTY", "1.05")),
        max_concurrency=int(os.getenv("TRANSLATION_MAX_CONCURRENCY", "1")),
        max_queue_size=int(os.getenv("TRANSLATION_MAX_QUEUE_SIZE", "64")),
        queue_timeout_ms=int(os.getenv("TRANSLATION_QUEUE_TIMEOUT_MS", "2000")),
        micro_batch_size=int(os.getenv("TRANSLATION_MICRO_BATCH_SIZE", "4")),
        micro_batch_window_ms=int(os.getenv("TRANSLATION_MICRO_BATCH_WINDOW_MS", "8")),
    )
