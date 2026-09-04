from types import SimpleNamespace

import numpy as np
import pytest

from app.qwen3_vllm_engine import LocalQwen3VllmAsrRunner


class FakeModel:
    def __init__(self) -> None:
        self.states: list[SimpleNamespace] = []
        self.stream_calls = 0
        self.stream_sizes: list[int] = []
        self.transcribe_calls: list[dict] = []
        self.engine_shutdown_calls = 0
        engine_core = SimpleNamespace(shutdown=self._shutdown_engine)
        self.model = SimpleNamespace(
            llm_engine=SimpleNamespace(engine_core=engine_core)
        )

    def init_streaming_state(self, **kwargs):
        values = {
            "chunk_id": 0,
            "text": "",
            "language": kwargs.get("language") or "Chinese",
            "chunk_size_samples": round(
                float(kwargs.get("chunk_size_sec", 1.0)) * 16000
            ),
            **kwargs,
        }
        state = SimpleNamespace(**values)
        self.states.append(state)
        return state

    def streaming_transcribe(self, audio, state) -> None:
        assert state in self.states
        self.stream_calls += 1
        self.stream_sizes.append(len(audio))
        if len(audio) >= state.chunk_size_samples:
            state.chunk_id += 1
            state.text = f"第{state.chunk_id}次解码"

    def transcribe(self, **kwargs):
        self.transcribe_calls.append(kwargs)
        return [SimpleNamespace(text="  测试结果  ")]

    def _shutdown_engine(self) -> None:
        self.engine_shutdown_calls += 1


def runner(model: FakeModel, destroy) -> LocalQwen3VllmAsrRunner:
    return LocalQwen3VllmAsrRunner(
        model_dir="/unused",
        dtype="bfloat16",
        max_inference_batch_size=1,
        max_new_tokens=256,
        gpu_memory_utilization=0.35,
        max_model_len=8192,
        max_num_seqs=1,
        enforce_eager=True,
        unfixed_chunk_num=7,
        unfixed_token_num=5,
        model=model,
        destroy_distributed_groups=destroy,
    )


def test_vllm_runner_prewarms_chinese_and_auto(monkeypatch) -> None:
    monkeypatch.setenv("VLLM_ENABLE_V1_MULTIPROCESSING", "0")
    model = FakeModel()
    instance = runner(model, lambda: None)

    instance.prewarm()

    assert [state.language for state in model.states] == ["Chinese", None]
    assert all(state.unfixed_chunk_num == 7 for state in model.states)
    assert all(state.unfixed_token_num == 5 for state in model.states)
    assert model.stream_calls == 2


def test_vllm_runner_transcribes_and_trims_text(monkeypatch) -> None:
    monkeypatch.setenv("VLLM_ENABLE_V1_MULTIPROCESSING", "0")
    model = FakeModel()
    instance = runner(model, lambda: None)

    text = instance.transcribe("/tmp/audio.wav", "Chinese", "术语上下文")

    assert text == "测试结果"
    assert model.transcribe_calls == [{
        "audio": "/tmp/audio.wav",
        "context": "术语上下文",
        "language": "Chinese",
    }]


def test_vllm_runner_uses_frozen_stable_partial_schedule(monkeypatch) -> None:
    monkeypatch.setenv("VLLM_ENABLE_V1_MULTIPROCESSING", "0")
    model = FakeModel()
    instance = runner(model, lambda: None)

    state = instance.new_streaming_state("Chinese", "术语上下文")
    first = instance.push_streaming(state, np.zeros(8000, dtype=np.float32))
    second = instance.push_streaming(state, np.zeros(3200, dtype=np.float32))

    assert state.context == "术语上下文"
    assert state.unfixed_chunk_num == 4
    assert state.unfixed_token_num == 5
    assert first == (1, "第1次解码", "Chinese")
    assert second == (2, "第2次解码", "Chinese")
    assert state.chunk_size_samples == 3200


def test_vllm_runner_shutdown_is_idempotent(monkeypatch) -> None:
    monkeypatch.setenv("VLLM_ENABLE_V1_MULTIPROCESSING", "0")
    model = FakeModel()
    distributed_shutdown_calls = 0

    def destroy() -> None:
        nonlocal distributed_shutdown_calls
        distributed_shutdown_calls += 1

    instance = runner(model, destroy)
    instance.shutdown()
    instance.shutdown()

    assert model.engine_shutdown_calls == 1
    assert distributed_shutdown_calls == 1
    with pytest.raises(RuntimeError, match="runner is stopped"):
        instance.transcribe("/tmp/audio.wav", None, "")


def test_vllm_runner_rejects_multiprocess_engine_core(monkeypatch) -> None:
    monkeypatch.setenv("VLLM_ENABLE_V1_MULTIPROCESSING", "1")

    with pytest.raises(RuntimeError, match="VLLM_ENABLE_V1_MULTIPROCESSING=0"):
        runner(FakeModel(), lambda: None)
