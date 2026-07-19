import asyncio

import pytest

from app.errors import TtsUnavailableError
from app.schemas import TtsSynthesizeRequest
from app.voxcpm2_engine import VoxCpm2TtsEngine
from voxcpm2_test_fakes import BlockingStreamingVoxCpmModel, FakeVoxCpmModel


@pytest.mark.asyncio
async def test_voxcpm2_engine_serializes_concurrent_streams(tmp_path) -> None:
    model = BlockingStreamingVoxCpmModel()
    engine = VoxCpm2TtsEngine(
        model_dir=str(tmp_path),
        cfg_value=2.0,
        inference_timesteps=10,
        inference_wait_ms=1000,
        load_denoiser=False,
    )
    engine._model = model

    first = asyncio.create_task(collect_stream(engine, "seg_first"))
    assert await asyncio.to_thread(model.started.wait, 1)
    second = asyncio.create_task(collect_stream(engine, "seg_second"))
    await asyncio.sleep(0.02)

    assert model.streaming_calls == 1
    model.release.set()
    first_events, second_events = await asyncio.gather(first, second)

    assert model.streaming_calls == 2
    assert model.peak_active == 1
    assert first_events[-1]["type"] == "final"
    assert second_events[-1]["type"] == "final"


@pytest.mark.asyncio
async def test_voxcpm2_engine_rejects_a_full_inference_gate_after_timeout(
    tmp_path,
) -> None:
    engine = VoxCpm2TtsEngine(
        model_dir=str(tmp_path),
        cfg_value=2.0,
        inference_timesteps=10,
        inference_wait_ms=5,
        load_denoiser=False,
    )
    engine._model = FakeVoxCpmModel()
    await engine._inference_lock.acquire()
    try:
        with pytest.raises(TtsUnavailableError, match="remained busy for 5ms"):
            await engine.synthesize(request("seg_busy"))
    finally:
        engine._inference_lock.release()


@pytest.mark.asyncio
async def test_cancelled_stream_keeps_gate_until_inflight_chunk_returns(
    tmp_path,
) -> None:
    model = BlockingStreamingVoxCpmModel()
    engine = VoxCpm2TtsEngine(
        model_dir=str(tmp_path),
        cfg_value=2.0,
        inference_timesteps=10,
        inference_wait_ms=1000,
        load_denoiser=False,
    )
    engine._model = model
    first = asyncio.create_task(collect_stream(engine, "seg_cancelled"))
    assert await asyncio.to_thread(model.started.wait, 1)

    first.cancel()
    second = asyncio.create_task(collect_stream(engine, "seg_after_cancel"))
    await asyncio.sleep(0.02)
    assert model.streaming_calls == 1
    assert not first.done()

    model.release.set()
    with pytest.raises(asyncio.CancelledError):
        await first
    second_events = await second

    assert model.streaming_calls == 2
    assert model.peak_active == 1
    assert second_events[-1]["type"] == "final"


async def collect_stream(engine: VoxCpm2TtsEngine, segment_id: str):
    return [event async for event in engine.synthesize_stream(request(segment_id))]


def request(segment_id: str) -> TtsSynthesizeRequest:
    return TtsSynthesizeRequest(
        text="Streaming.",
        language="en",
        speakerRole="guest",
        segmentId=segment_id,
    )
