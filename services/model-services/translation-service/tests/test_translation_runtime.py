import asyncio

import pytest

from app.config import TranslationConfig
from app.engines import TranslationEngine, TranslationInput
from app.service import TranslationService
from app.translation_runtime import (
    TranslationAdmission,
    TranslationCapacityError,
    TranslationRuntime,
)


def test_micro_batch_coalesces_compatible_requests() -> None:
    engine = RecordingBatchEngine()
    runtime = TranslationRuntime(
        TranslationService(engine, TranslationConfig()),
        TranslationConfig(micro_batch_window_ms=10),
    )

    async def run() -> list[str]:
        return await asyncio.gather(
            runtime.batcher.submit(translation("one")),
            runtime.batcher.submit(translation("two")),
        )

    assert asyncio.run(run()) == ["translated:one", "translated:two"]
    assert engine.batch_sizes == [2]
    assert runtime.metrics()["batches"] == 1


def test_micro_batch_separates_incompatible_token_limits() -> None:
    engine = RecordingBatchEngine()
    runtime = TranslationRuntime(
        TranslationService(engine, TranslationConfig()),
        TranslationConfig(micro_batch_window_ms=0),
    )

    async def run() -> list[str]:
        return await asyncio.gather(
            runtime.batcher.submit(translation("one", max_tokens=64)),
            runtime.batcher.submit(translation("two", max_tokens=128)),
        )

    assert asyncio.run(run()) == ["translated:one", "translated:two"]
    assert engine.batch_sizes == [1, 1]


def test_admission_rejects_waiters_beyond_the_bound() -> None:
    async def run() -> None:
        admission = TranslationAdmission(1, 1, 1000)
        active = await admission.acquire()
        waiter = asyncio.create_task(admission.acquire())
        while admission.waiting == 0:
            await asyncio.sleep(0)
        with pytest.raises(TranslationCapacityError):
            await admission.acquire()
        await active.release()
        queued = await waiter
        await queued.release()
        assert admission.active == 0
        assert admission.rejected == 1

    asyncio.run(run())


class RecordingBatchEngine(TranslationEngine):
    batch_sizes: list[int]

    def __init__(self) -> None:
        self.batch_sizes = []

    def translate(self, request: TranslationInput) -> str:
        return f"translated:{request.text}"

    def translate_batch(self, requests: list[TranslationInput]) -> list[str]:
        self.batch_sizes.append(len(requests))
        return [self.translate(request) for request in requests]


def translation(text: str, max_tokens: int = 128) -> TranslationInput:
    return TranslationInput(text=text, target_language="zh", max_tokens=max_tokens)
