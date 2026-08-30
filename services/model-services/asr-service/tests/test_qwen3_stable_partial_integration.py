import base64
import asyncio
from types import SimpleNamespace

import numpy as np

from app.qwen3_engine import Qwen3AsrEngine
from app.schemas import AsrTranscribeRequest


class StreamingFinalRunner:
    def __init__(self) -> None:
        self.partial_texts = ["今天开会", "今天开会讨论产品"]
        self.partial_calls = 0
        self.final_calls = 0

    def new_streaming_state(self, language: str | None, context: str):
        return SimpleNamespace(chunk_id=0, language=language, context=context)

    def push_streaming(self, state, _audio: np.ndarray):
        state.chunk_id += 1
        index = min(state.chunk_id - 1, len(self.partial_texts) - 1)
        self.partial_calls += 1
        return state.chunk_id, self.partial_texts[index], "Chinese"

    def transcribe(self, _audio_path: str, _language: str | None, _context: str):
        self.final_calls += 1
        return "今天开会讨论产品计划。"


class EmptyFinalRunner(StreamingFinalRunner):
    def transcribe(self, _audio_path: str, _language: str | None, _context: str):
        self.final_calls += 1
        return ""


async def test_stable_partial_and_batch_final_share_segment_revision_chain() -> None:
    runner = StreamingFinalRunner()
    engine = Qwen3AsrEngine(
        model_dir="/unused",
        dtype="bfloat16",
        device_map="cuda:0",
        max_inference_batch_size=1,
        max_new_tokens=256,
        min_audio_ms=500,
        endpoint_silence_ms=600,
        max_audio_ms=8000,
        preroll_ms=0,
        vad_energy_threshold=350,
        listening_stable_partial_enabled=True,
        runner=runner,
    )

    assert await engine.transcribe(frame(1, 0, 500)) is None
    await wait_for_completed_push(engine, 1)
    assert await engine.transcribe(frame(2, 500, 200)) is None
    await wait_for_completed_push(engine, 2)
    partial = await engine.transcribe(frame(3, 700, 20))
    await wait_for_completed_push(engine, 3)
    final = await engine.flush("sess_1", "zh", "en")

    assert partial is not None
    assert partial.segmentId == "qwen3_seg_1"
    assert partial.revision == 0
    assert partial.isFinal is False
    assert partial.text == "今天开会"
    assert final is not None
    assert final.segmentId == partial.segmentId
    assert final.revision == 1
    assert final.isFinal is True
    assert final.endpointReason == "flush"
    assert final.text == "今天开会讨论产品计划。"
    assert runner.partial_calls == 3
    assert runner.final_calls == 1
    assert engine.diagnostics("sess_1")["stablePartial"]["emittedCount"] == 1


async def test_promotes_last_stable_partial_when_silence_endpoint_final_is_empty() -> None:
    runner = EmptyFinalRunner()
    engine = Qwen3AsrEngine(
        model_dir="/unused",
        dtype="bfloat16",
        device_map="cuda:0",
        max_inference_batch_size=1,
        max_new_tokens=256,
        min_audio_ms=500,
        endpoint_silence_ms=600,
        max_audio_ms=8000,
        preroll_ms=0,
        vad_energy_threshold=350,
        listening_stable_partial_enabled=True,
        runner=runner,
    )

    assert await engine.transcribe(frame(1, 0, 500)) is None
    await wait_for_completed_push(engine, 1)
    assert await engine.transcribe(frame(2, 500, 200)) is None
    await wait_for_completed_push(engine, 2)
    partial = await engine.transcribe(frame(3, 700, 20))
    await wait_for_completed_push(engine, 3)
    final = await engine.transcribe(frame(4, 720, 600, amplitude=0))

    assert partial is not None
    assert final is not None
    assert final.segmentId == partial.segmentId
    assert final.revision == 1
    assert final.isFinal is True
    assert final.endpointReason == "silence"
    assert final.text == partial.text
    assert await engine.flush("sess_1", "zh", "en") is None


async def test_promotes_last_stable_partial_when_flush_final_is_empty() -> None:
    runner = EmptyFinalRunner()
    engine = Qwen3AsrEngine(
        model_dir="/unused",
        dtype="bfloat16",
        device_map="cuda:0",
        max_inference_batch_size=1,
        max_new_tokens=256,
        min_audio_ms=500,
        endpoint_silence_ms=600,
        max_audio_ms=8000,
        preroll_ms=0,
        vad_energy_threshold=350,
        listening_stable_partial_enabled=True,
        runner=runner,
    )

    assert await engine.transcribe(frame(1, 0, 500)) is None
    await wait_for_completed_push(engine, 1)
    assert await engine.transcribe(frame(2, 500, 200)) is None
    await wait_for_completed_push(engine, 2)
    partial = await engine.transcribe(frame(3, 700, 20))
    await wait_for_completed_push(engine, 3)
    final = await engine.flush("sess_1", "zh", "en")

    assert partial is not None
    assert final is not None
    assert final.segmentId == partial.segmentId
    assert final.revision == 1
    assert final.isFinal is True
    assert final.endpointReason == "flush"
    assert final.text == partial.text


async def test_flush_uses_one_inflight_confirmation_when_no_partial_was_sent() -> None:
    runner = EmptyFinalRunner()
    engine = Qwen3AsrEngine(
        model_dir="/unused",
        dtype="bfloat16",
        device_map="cuda:0",
        max_inference_batch_size=1,
        max_new_tokens=256,
        min_audio_ms=500,
        endpoint_silence_ms=600,
        max_audio_ms=8000,
        preroll_ms=0,
        vad_energy_threshold=350,
        listening_stable_partial_enabled=True,
        runner=runner,
    )

    assert await engine.transcribe(frame(1, 0, 500)) is None
    await wait_for_completed_push(engine, 1)
    assert await engine.transcribe(frame(2, 500, 200)) is None
    final = await engine.flush("sess_1", "zh", "en")

    assert final is not None
    assert final.revision is None
    assert final.endpointReason == "flush"
    assert final.text == "今天开会"
    diagnostics = engine.diagnostics("sess_1")["stablePartial"]
    assert diagnostics["decisionCount"] == 2
    assert diagnostics["emittedCount"] == 0


def frame(
    sequence: int,
    timestamp_ms: int,
    duration_ms: int,
    amplitude: int = 1000,
) -> AsrTranscribeRequest:
    samples = np.full(
        16000 * duration_ms // 1000,
        amplitude,
        dtype="<i2",
    )
    return AsrTranscribeRequest(
        sessionId="sess_1",
        sequence=sequence,
        timestampMs=timestamp_ms,
        format="pcm16",
        sampleRate=16000,
        data=base64.b64encode(samples.tobytes()).decode("ascii"),
        sourceLanguage="zh",
        targetLanguage="en",
        mode="listening",
    )


async def wait_for_completed_push(engine: Qwen3AsrEngine, count: int) -> None:
    async def wait() -> None:
        while engine.diagnostics("sess_1")["stablePartial"].get(
            "completedPushCount",
            0,
        ) < count:
            await asyncio.sleep(0.001)

    await asyncio.wait_for(wait(), timeout=1)
