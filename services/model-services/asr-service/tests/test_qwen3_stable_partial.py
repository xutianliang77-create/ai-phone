import asyncio
from types import SimpleNamespace

import numpy as np

from app.audio_segment_state import ActivePcmAudio
from app.qwen3_stable_partial import (
    StableReadablePartialCoordinator,
    confirmed_readable_prefix,
    pcm16_to_float_16k,
)
from app.schemas import AsrTranscribeRequest


class FakeStreamingRunner:
    def __init__(
        self,
        texts: list[str],
        language: str | list[str] = "Chinese",
    ) -> None:
        self.texts = texts
        self.languages = language if isinstance(language, list) else [language]
        self.new_states: list[tuple[str | None, str]] = []
        self.push_sizes: list[int] = []

    def new_streaming_state(self, language: str | None, context: str):
        self.new_states.append((language, context))
        return SimpleNamespace(chunk_id=0)

    def push_streaming(self, state, audio: np.ndarray):
        self.push_sizes.append(len(audio))
        state.chunk_id += 1
        index = min(state.chunk_id - 1, len(self.texts) - 1)
        language_index = min(state.chunk_id - 1, len(self.languages) - 1)
        return state.chunk_id, self.texts[index], self.languages[language_index]


async def test_emits_only_an_adjacent_confirmed_chinese_prefix() -> None:
    runner = FakeStreamingRunner(["会议开始", "会议开始了", "会议结束"])
    coordinator = StableReadablePartialCoordinator(runner, enabled=True)
    request = asr_request()

    assert await observe_settled(
        coordinator, request, active_audio(500)
    ) is None
    partial = await observe_settled(coordinator, request, active_audio(700))
    backtrack = await observe_settled(coordinator, request, active_audio(900))

    assert partial is not None
    assert partial.segmentId == "qwen3_seg_1"
    assert partial.revision == 0
    assert partial.isFinal is False
    assert partial.text == "会议开始"
    assert partial.language == "zh"
    assert backtrack is None
    finalization = await coordinator.finish("sess_1")
    assert finalization is not None
    assert finalization.segment_id == "qwen3_seg_1"
    assert finalization.revision == 1
    assert finalization.text == "会议开始"
    assert coordinator.diagnostics("sess_1")["rejectionCounts"] == {
        "insufficient_units": 1,
        "backtrack": 1,
    }


async def test_identical_decodes_are_valid_confirmation_evidence() -> None:
    runner = FakeStreamingRunner(["今天开会。", "今天开会。"])
    coordinator = StableReadablePartialCoordinator(runner, enabled=True)

    assert await observe_settled(
        coordinator, asr_request(), active_audio(500)
    ) is None
    partial = await observe_settled(coordinator, asr_request(), active_audio(700))

    assert partial is not None
    assert partial.text == "今天开会。"
    diagnostics = coordinator.diagnostics("sess_1")
    assert diagnostics["decodeCount"] == 2
    assert diagnostics["decisionCount"] == 2
    assert diagnostics["emittedCount"] == 1
    assert diagnostics["firstStablePartialLatencyMs"] is not None


async def test_gates_partial_to_listening_and_detected_chinese() -> None:
    conversation_runner = FakeStreamingRunner(["会议", "会议开始"])
    conversation = StableReadablePartialCoordinator(
        conversation_runner,
        enabled=True,
    )
    assert await conversation.observe(
        asr_request(mode="conversation"), active_audio(500), ""
    ) is None
    assert conversation_runner.push_sizes == []

    german_runner = FakeStreamingRunner(["Guten Tag", "Guten Tag"], "German")
    auto = StableReadablePartialCoordinator(german_runner, enabled=True)
    request = asr_request(source_language="auto")
    assert await observe_settled(auto, request, active_audio(500)) is None
    assert await observe_settled(auto, request, active_audio(700)) is None
    diagnostics = auto.diagnostics("sess_1")
    assert diagnostics["emittedCount"] == 0
    assert diagnostics["rejectionCounts"] == {
        "insufficient_units": 1,
        "language_gate": 1,
    }


async def test_reports_privacy_safe_stable_partial_rejection_reasons() -> None:
    empty = StableReadablePartialCoordinator(
        FakeStreamingRunner(["", ""]),
        enabled=True,
    )
    assert await observe_settled(
        empty, asr_request(), active_audio(500)
    ) is None
    assert await observe_settled(
        empty, asr_request(), active_audio(700)
    ) is None
    assert empty.diagnostics("sess_1")["rejectionCounts"] == {"no_text": 2}

    echoed_text = "这是用于检测上下文回声的长文本内容一二三四五六七八九十"
    context = f"系统提示：{echoed_text}。请仅返回语音内容。"
    context_echo = StableReadablePartialCoordinator(
        FakeStreamingRunner([echoed_text, echoed_text]),
        enabled=True,
    )
    assert await observe_settled(
        context_echo, asr_request(), active_audio(500), context
    ) is None
    assert await observe_settled(
        context_echo, asr_request(), active_audio(700), context
    ) is None
    assert context_echo.diagnostics("sess_1")["rejectionCounts"] == {
        "insufficient_units": 1,
        "context_echo": 1,
    }

    duplicate = StableReadablePartialCoordinator(
        FakeStreamingRunner(
            ["会议开始", "会议开始了", "会议开始了", "会议开始了"]
        ),
        enabled=True,
    )
    for duration_ms in (500, 700, 900, 1000):
        await observe_settled(
            duplicate,
            asr_request(),
            active_audio(duration_ms),
        )
    assert duplicate.diagnostics("sess_1")["rejectionCounts"] == {
        "insufficient_units": 1,
        "duplicate_partial": 1,
    }


async def test_reports_native_language_evidence_without_changing_the_gate() -> None:
    coordinator = StableReadablePartialCoordinator(
        FakeStreamingRunner(
            ["", "会议", "会议开始", "会议开始了"],
            ["", "English", "Chinese,English", "Chinese"],
        ),
        enabled=True,
    )
    request = asr_request(source_language="auto")

    for duration_ms in (500, 700, 900):
        assert await observe_settled(
            coordinator,
            request,
            active_audio(duration_ms),
        ) is None
    partial = await observe_settled(coordinator, request, active_audio(1000))

    assert partial is not None
    assert partial.text == "会议开始"
    diagnostics = coordinator.diagnostics("sess_1")
    assert diagnostics["languageEvidenceSource"] == "qwen_streaming_state_label"
    assert diagnostics["languageEvidenceCounts"] == {
        "empty": 1,
        "en": 1,
        "zh_en": 1,
        "zh": 1,
    }
    assert diagnostics["languageGateCounts"] == {"zh_en": 1}
    assert diagnostics["rejectionCounts"] == {
        "no_text": 1,
        "insufficient_units": 1,
        "language_gate": 1,
    }


def test_fillers_do_not_count_as_readable_units() -> None:
    assert confirmed_readable_prefix("嗯", "嗯好", 2) is None
    assert confirmed_readable_prefix("嗯会议", "嗯会议开始", 2) == "嗯会议"


def test_resamples_24khz_pcm_to_16khz_float() -> None:
    pcm = np.full(2400, 1000, dtype="<i2").tobytes()

    audio = pcm16_to_float_16k(pcm, 24000)

    assert audio.dtype == np.float32
    assert len(audio) == 1600
    assert np.max(np.abs(audio)) < 1


def asr_request(
    *,
    mode: str = "listening",
    source_language: str = "zh",
) -> AsrTranscribeRequest:
    return AsrTranscribeRequest(
        sessionId="sess_1",
        sequence=1,
        timestampMs=0,
        format="pcm16",
        sampleRate=16000,
        data="AA==",
        sourceLanguage=source_language,
        targetLanguage="en",
        mode=mode,
    )


def active_audio(duration_ms: int) -> ActivePcmAudio:
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


async def wait_for_completed_push(
    coordinator: StableReadablePartialCoordinator,
    count: int,
) -> None:
    async def wait() -> None:
        while coordinator.diagnostics("sess_1").get("completedPushCount", 0) < count:
            await asyncio.sleep(0.001)

    await asyncio.wait_for(wait(), timeout=1)


async def observe_settled(
    coordinator: StableReadablePartialCoordinator,
    request: AsrTranscribeRequest,
    audio: ActivePcmAudio,
    context: str = "",
):
    result = await coordinator.observe(request, audio, context)
    scheduled = coordinator.diagnostics(request.sessionId).get(
        "scheduledPushCount",
        0,
    )
    await wait_for_completed_push(coordinator, scheduled)
    drained = await coordinator.observe(request, audio, context)
    return drained if drained is not None else result
