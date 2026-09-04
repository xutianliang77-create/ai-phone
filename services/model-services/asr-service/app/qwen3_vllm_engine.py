import os
import threading
from typing import Callable

import numpy as np

from app.qwen3_stable_partial import (
    STABLE_PARTIAL_DECODE_SCHEDULE_MS,
    STABLE_PARTIAL_STEADY_DECODE_MS,
    STABLE_PARTIAL_UNFIXED_CHUNK_NUM,
    STABLE_PARTIAL_UNFIXED_TOKEN_NUM,
)


class LocalQwen3VllmAsrRunner:
    def __init__(
        self,
        model_dir: str,
        dtype: str,
        max_inference_batch_size: int,
        max_new_tokens: int,
        gpu_memory_utilization: float,
        max_model_len: int,
        max_num_seqs: int,
        enforce_eager: bool,
        unfixed_chunk_num: int,
        unfixed_token_num: int,
        model=None,
        destroy_distributed_groups: Callable[[], None] | None = None,
    ) -> None:
        if os.environ.get("VLLM_ENABLE_V1_MULTIPROCESSING", "0") != "0":
            raise RuntimeError(
                "qwen3_asr_vllm requires VLLM_ENABLE_V1_MULTIPROCESSING=0"
            )
        os.environ.setdefault("VLLM_ENABLE_V1_MULTIPROCESSING", "0")
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

        if model is None:
            from qwen_asr import Qwen3ASRModel

            model = Qwen3ASRModel.LLM(
                model=model_dir,
                max_inference_batch_size=max_inference_batch_size,
                max_new_tokens=max_new_tokens,
                gpu_memory_utilization=gpu_memory_utilization,
                max_model_len=max_model_len,
                max_num_seqs=max_num_seqs,
                enforce_eager=enforce_eager,
                hf_overrides={"dtype": dtype},
            )
        self._model = model
        self._unfixed_chunk_num = unfixed_chunk_num
        self._unfixed_token_num = unfixed_token_num
        self._lock = threading.Lock()
        self._stopped = False
        self._destroy_distributed_groups = destroy_distributed_groups

    def prewarm(self) -> None:
        silence = np.zeros(16_000, dtype=np.float32)
        with self._lock:
            self._ensure_running()
            for language in ("Chinese", None):
                state = self._model.init_streaming_state(
                    language=language,
                    unfixed_chunk_num=self._unfixed_chunk_num,
                    unfixed_token_num=self._unfixed_token_num,
                    chunk_size_sec=1.0,
                )
                self._model.streaming_transcribe(silence, state)

    def transcribe(self, audio_path: str, language: str | None, context: str) -> str:
        with self._lock:
            self._ensure_running()
            result = self._model.transcribe(
                audio=audio_path,
                context=context,
                language=language,
            )
        if not result:
            return ""
        return str(getattr(result[0], "text", "")).strip()

    def new_streaming_state(self, language: str | None, context: str):
        with self._lock:
            self._ensure_running()
            return self._model.init_streaming_state(
                context=context,
                language=language,
                unfixed_chunk_num=STABLE_PARTIAL_UNFIXED_CHUNK_NUM,
                unfixed_token_num=STABLE_PARTIAL_UNFIXED_TOKEN_NUM,
                chunk_size_sec=STABLE_PARTIAL_DECODE_SCHEDULE_MS[0] / 1000,
            )

    def push_streaming(
        self,
        state: object,
        audio: np.ndarray,
    ) -> tuple[int, str, str]:
        with self._lock:
            self._ensure_running()
            previous_decode_id = int(getattr(state, "chunk_id", 0))
            self._model.streaming_transcribe(audio, state)
            decode_id = int(getattr(state, "chunk_id", 0))
            if decode_id != previous_decode_id:
                next_samples = self._next_streaming_decode_samples(decode_id)
                state.chunk_size_samples = next_samples
                state.chunk_size_sec = next_samples / 16000
            return (
                decode_id,
                str(getattr(state, "text", "") or "").strip(),
                str(getattr(state, "language", "") or "").strip(),
            )

    def shutdown(self) -> None:
        with self._lock:
            if self._stopped:
                return
            self._stopped = True
            errors: list[str] = []
            try:
                self._model.model.llm_engine.engine_core.shutdown()
            except Exception as exc:
                errors.append(f"engine_core={type(exc).__name__}: {exc}")
            try:
                if self._destroy_distributed_groups is not None:
                    self._destroy_distributed_groups()
                else:
                    destroy_distributed_groups()
            except Exception as exc:
                errors.append(f"distributed={type(exc).__name__}: {exc}")
            if errors:
                raise RuntimeError("; ".join(errors))

    def _ensure_running(self) -> None:
        if self._stopped:
            raise RuntimeError("Qwen3-ASR vLLM runner is stopped")

    @staticmethod
    def _next_streaming_decode_samples(completed_decode_count: int) -> int:
        schedule = STABLE_PARTIAL_DECODE_SCHEDULE_MS
        if completed_decode_count < len(schedule):
            return round(
                16000
                * (schedule[completed_decode_count] - schedule[completed_decode_count - 1])
                / 1000
            )
        return round(16000 * STABLE_PARTIAL_STEADY_DECODE_MS / 1000)


def destroy_distributed_groups() -> None:
    from vllm.distributed.parallel_state import (
        destroy_distributed_environment,
        destroy_model_parallel,
    )

    destroy_model_parallel()
    destroy_distributed_environment()
