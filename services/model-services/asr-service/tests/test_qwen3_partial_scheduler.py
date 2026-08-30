import asyncio
from threading import Event
from types import SimpleNamespace

import numpy as np

from app.audio_segment_state import ActivePcmAudio
from app.qwen3_stable_partial import StableReadablePartialCoordinator
from app.schemas import AsrTranscribeRequest


class BlockingStreamingRunner:
    def __init__(self, texts: list[str]) -> None:
        self.texts = texts
        self.started = [Event() for _ in texts]
        self.release = [Event() for _ in texts]
        self.push_sizes: list[int] = []

    def new_streaming_state(self, _language: str | None, _context: str):
        return SimpleNamespace(chunk_id=0)

    def push_streaming(self, state, audio: np.ndarray):
        index = min(state.chunk_id, len(self.started) - 1)
        self.started[index].set()
        if not self.release[index].wait(timeout=2):
            raise TimeoutError("test partial decode was not released")
        self.push_sizes.append(len(audio))
        state.chunk_id += 1
        text = self.texts[min(state.chunk_id - 1, len(self.texts) - 1)]
        return state.chunk_id, text, "Chinese"


class ChunkAwareBlockingRunner(BlockingStreamingRunner):
    def new_streaming_state(self, _language: str | None, _context: str):
        return SimpleNamespace(chunk_id=0, chunk_size_samples=8000)

    def push_streaming(self, state, audio: np.ndarray):
        result = super().push_streaming(state, audio)
        state.chunk_size_samples = 3200
        return result


class ScheduledChunkRunner(BlockingStreamingRunner):
    next_sizes = [3200, 3200, 1600, 16000, 16000, 16000, 16000, 16000]

    def new_streaming_state(self, _language: str | None, _context: str):
        return SimpleNamespace(chunk_id=0, chunk_size_samples=8000)

    def push_streaming(self, state, audio: np.ndarray):
        result = super().push_streaming(state, audio)
        state.chunk_size_samples = self.next_sizes[state.chunk_id - 1]
        return result


async def test_does_not_start_the_six_second_decode_before_finalization() -> None:
    decode_points = [500, 700, 900, 1000, 2000, 3000, 4000, 5000]
    runner = ScheduledChunkRunner(["会议开始"] * len(decode_points))
    coordinator = StableReadablePartialCoordinator(runner, enabled=True)

    for index, duration_ms in enumerate(decode_points):
        await assert_nonblocking_observe(
            coordinator,
            runner,
            index,
            duration_ms,
        )
        await release_and_wait(coordinator, runner, index, index + 1)
        await coordinator.observe(request(), audio(duration_ms), "")

    assert await coordinator.observe(request(), audio(5980), "") is None
    diagnostics = coordinator.diagnostics("sess_1")
    assert diagnostics["scheduledPushCount"] == 8
    assert diagnostics["inFlight"] is False
    assert diagnostics["pendingAudioMs"] == 980
    finalization = await coordinator.finish("sess_1")

    assert finalization is not None
    assert coordinator.diagnostics("sess_1")["invalidatedPushCount"] == 0
    assert runner.push_sizes == [
        8000,
        3200,
        3200,
        1600,
        16000,
        16000,
        16000,
        16000,
    ]


async def test_follows_model_chunk_targets_and_keeps_excess_pcm_pending() -> None:
    runner = ChunkAwareBlockingRunner(["会议开始", "会议开始了"])
    coordinator = StableReadablePartialCoordinator(runner, enabled=True)

    assert await coordinator.observe(request(), audio(480), "") is None
    diagnostics = coordinator.diagnostics("sess_1")
    assert diagnostics["scheduledPushCount"] == 0
    assert diagnostics["pendingAudioMs"] == 480

    await assert_nonblocking_observe(coordinator, runner, 0, 500)
    assert await coordinator.observe(request(), audio(800), "") is None
    assert coordinator.diagnostics("sess_1")["pendingAudioMs"] == 300
    await release_and_wait(coordinator, runner, 0, 1)
    assert await coordinator.observe(request(), audio(800), "") is None
    assert await asyncio.to_thread(runner.started[1].wait, 1)
    assert coordinator.diagnostics("sess_1")["pendingAudioMs"] == 100
    await release_and_wait(coordinator, runner, 1, 2)

    assert runner.push_sizes == [8000, 3200]
    assert coordinator.diagnostics("sess_1")["scheduledPushCount"] == 2


async def test_combines_twenty_millisecond_frames_into_forty_ms_pushes() -> None:
    runner = BlockingStreamingRunner(["会议", "会议开始"])
    coordinator = StableReadablePartialCoordinator(runner, enabled=True)

    assert await coordinator.observe(request(), audio(20), "") is None
    diagnostics = coordinator.diagnostics("sess_1")
    if diagnostics["scheduledPushCount"] != 0:
        runner.release[0].set()
    assert diagnostics["scheduledPushCount"] == 0
    assert diagnostics["pendingAudioMs"] == 20

    await assert_nonblocking_observe(coordinator, runner, 0, 40)
    await release_and_wait(coordinator, runner, 0, 1)
    assert await coordinator.observe(request(), audio(60), "") is None
    assert coordinator.diagnostics("sess_1")["pendingAudioMs"] == 20
    await assert_nonblocking_observe(coordinator, runner, 1, 80)
    await release_and_wait(coordinator, runner, 1, 2)

    assert runner.push_sizes == [640, 640]
    assert coordinator.diagnostics("sess_1")["scheduledPushCount"] == 2


async def test_coalesces_audio_without_blocking_on_a_slow_decode() -> None:
    runner = BlockingStreamingRunner(["会议开始", "会议开始了"])
    coordinator = StableReadablePartialCoordinator(runner, enabled=True)

    await assert_nonblocking_observe(coordinator, runner, 0, 500)
    assert await asyncio.wait_for(
        coordinator.observe(request(), audio(700), ""),
        timeout=0.1,
    ) is None
    diagnostics = coordinator.diagnostics("sess_1")
    assert diagnostics["coalescedObservationCount"] == 1
    assert diagnostics["pendingAudioMs"] == 200
    assert diagnostics["inFlight"] is True

    await release_and_wait(coordinator, runner, 0, 1)
    assert await coordinator.observe(request(), audio(700), "") is None
    assert await asyncio.to_thread(runner.started[1].wait, 1)
    await release_and_wait(coordinator, runner, 1, 2)
    partial = await coordinator.observe(request(), audio(700), "")

    assert partial is not None and partial.text == "会议开始"
    diagnostics = coordinator.diagnostics("sess_1")
    assert diagnostics["scheduledPushCount"] == 2
    assert diagnostics["completedPushCount"] == 2
    assert diagnostics["invalidatedPushCount"] == 0
    assert diagnostics["maxPendingAudioMs"] == 200
    assert diagnostics["inFlight"] is False
    assert runner.push_sizes == [8000, 3200]


async def test_finish_invalidates_only_one_push_after_a_partial_was_emitted() -> None:
    runner = BlockingStreamingRunner(
        ["会议开始", "会议开始了", "会议开始继续"]
    )
    coordinator = StableReadablePartialCoordinator(runner, enabled=True)

    await assert_nonblocking_observe(coordinator, runner, 0, 500)
    await release_and_wait(coordinator, runner, 0, 1)
    assert await coordinator.observe(request(), audio(500), "") is None
    await assert_nonblocking_observe(coordinator, runner, 1, 700)
    await release_and_wait(coordinator, runner, 1, 2)
    partial = await coordinator.observe(request(), audio(700), "")
    assert partial is not None
    await assert_nonblocking_observe(coordinator, runner, 2, 900)

    finish = asyncio.create_task(coordinator.finish("sess_1"))
    await asyncio.sleep(0)
    assert finish.done()
    finalization = await finish
    assert finalization is not None and finalization.text == "会议开始"
    assert coordinator.diagnostics("sess_1")["inFlight"] is True

    await release_and_wait(coordinator, runner, 2, 3)
    diagnostics = coordinator.diagnostics("sess_1")
    assert diagnostics["invalidatedPushCount"] == 1
    assert diagnostics["inFlight"] is False


async def test_finish_waits_for_one_push_to_preserve_an_empty_final_fallback() -> None:
    runner = BlockingStreamingRunner(["会议开始", "会议开始了"])
    coordinator = StableReadablePartialCoordinator(runner, enabled=True)

    await assert_nonblocking_observe(coordinator, runner, 0, 500)
    await release_and_wait(coordinator, runner, 0, 1)
    assert await coordinator.observe(request(), audio(500), "") is None
    await assert_nonblocking_observe(coordinator, runner, 1, 700)

    finish = asyncio.create_task(coordinator.finish("sess_1"))
    await asyncio.sleep(0)
    assert finish.done() is False
    runner.release[1].set()
    finalization = await asyncio.wait_for(finish, timeout=1)

    assert finalization is not None
    assert finalization.text == "会议开始"
    assert finalization.revision is None
    diagnostics = coordinator.diagnostics("sess_1")
    assert diagnostics["decisionCount"] == 2
    assert diagnostics["emittedCount"] == 0
    assert diagnostics["rejectionCounts"] == {
        "insufficient_units": 1,
        "final_fallback": 1,
    }
    assert diagnostics["invalidatedPushCount"] == 0


async def assert_nonblocking_observe(
    coordinator: StableReadablePartialCoordinator,
    runner: BlockingStreamingRunner,
    index: int,
    duration_ms: int,
) -> None:
    observed = asyncio.create_task(
        coordinator.observe(request(), audio(duration_ms), "")
    )
    assert await asyncio.to_thread(runner.started[index].wait, 1)
    assert observed.done()
    assert await observed is None


async def release_and_wait(
    coordinator: StableReadablePartialCoordinator,
    runner: BlockingStreamingRunner,
    index: int,
    completed: int,
) -> None:
    runner.release[index].set()

    async def wait() -> None:
        while coordinator.diagnostics("sess_1")["completedPushCount"] < completed:
            await asyncio.sleep(0.001)

    await asyncio.wait_for(wait(), timeout=1)


def request() -> AsrTranscribeRequest:
    return AsrTranscribeRequest(
        sessionId="sess_1",
        sequence=1,
        timestampMs=0,
        format="pcm16",
        sampleRate=16000,
        data="AA==",
        sourceLanguage="zh",
        targetLanguage="en",
        mode="listening",
    )


def audio(duration_ms: int) -> ActivePcmAudio:
    samples = np.full(16000 * duration_ms // 1000, 1000, dtype="<i2")
    return ActivePcmAudio(
        pcm=samples.tobytes(),
        sample_rate=16000,
        start_sequence=1,
        end_sequence=max(1, duration_ms // 200),
        duration_ms=duration_ms,
        start_timestamp_ms=0,
        end_timestamp_ms=duration_ms,
    )
