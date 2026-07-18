import base64
import json
import math

import pytest

from app.audio import normalize_audio_loudness, resample_audio
from app.schemas import TtsSynthesizeRequest
from app.voxcpm2_engine import (
    VoxCpm2TtsEngine,
    build_voxcpm2_text,
    parse_model_sample_rate,
    voxcpm2_generate_kwargs,
)


def test_voxcpm2_text_never_inserts_a_spoken_control_prompt() -> None:
    assert build_voxcpm2_text("你好", "zh") == "你好"
    assert build_voxcpm2_text("hello", "en") == "hello"


def test_low_volume_audio_is_raised_without_clipping() -> None:
    source = [0.02 * math.sin(2 * math.pi * 440 * index / 24000) for index in range(24000)]

    output = normalize_audio_loudness(source)
    rms = math.sqrt(sum(value * value for value in output) / len(output))

    assert 0.11 <= rms <= 0.126
    assert max(abs(value) for value in output) <= 0.95


def test_normal_volume_and_silence_are_not_changed() -> None:
    normal = [0.5, -0.5, 0.25, -0.25]
    assert normalize_audio_loudness(normal) == normal
    assert normalize_audio_loudness([0.0] * 100) == [0.0] * 100


def test_parse_model_sample_rate_preserves_real_model_rate() -> None:
    assert parse_model_sample_rate(16000) == 16000
    assert parse_model_sample_rate(24000) == 24000
    assert parse_model_sample_rate(48000) == 48000


@pytest.mark.parametrize("source_rate", [16000, 24000, 48000])
def test_resample_audio_preserves_one_second_tone(source_rate: int) -> None:
    source = [
        0.5 * math.sin(2 * math.pi * 440 * index / source_rate)
        for index in range(source_rate)
    ]

    output = resample_audio(
        source,
        source_rate=source_rate,
        target_rate=24000,
    )

    positive_crossings = sum(
        output[index - 1] <= 0 < output[index]
        for index in range(1, len(output))
    )
    assert len(output) == 24000
    assert 439 <= positive_crossings <= 441


def test_voxcpm2_kwargs_include_clone_reference_when_supported(tmp_path) -> None:
    reference = tmp_path / "my_voice.wav"
    reference.write_bytes(b"RIFF")
    request = TtsSynthesizeRequest(
        text="hello",
        language="en",
        speakerRole="guest",
        segmentId="seg_1",
        voice={
            "mode": "personal_clone",
            "voiceProfileId": "my_voice",
            "referenceAudioId": "my_voice",
            "controlPrompt": "clear and calm",
        },
    )

    def generate(**kwargs):
        return kwargs

    kwargs = voxcpm2_generate_kwargs(
        generate,
        text="hello",
        request=request,
        reference_wav_path=reference,
        cfg_value=2.0,
        inference_timesteps=10,
    )

    assert kwargs["reference_wav_path"] == str(reference)
    assert kwargs["retry_badcase"] is True
    assert kwargs["retry_badcase_max_times"] == 3
    assert kwargs["retry_badcase_ratio_threshold"] == 6.0
    assert "control" not in kwargs
    assert "control_prompt" not in kwargs
    assert "reference_text" not in kwargs
    assert "prompt_text" not in kwargs


def test_voxcpm2_kwargs_filter_streaming_wrapper_unknown_keys(tmp_path) -> None:
    reference = tmp_path / "my_voice.wav"
    reference.write_bytes(b"RIFF")
    request = TtsSynthesizeRequest(
        text="hello",
        language="en",
        speakerRole="guest",
        segmentId="seg_1",
        voice={
            "mode": "ultimate_clone",
            "voiceProfileId": "my_voice",
            "referenceAudioId": "my_voice",
            "referenceTranscript": "hello",
            "controlPrompt": "clear and calm",
        },
    )

    def generate_streaming(**kwargs):
        yield kwargs

    kwargs = voxcpm2_generate_kwargs(
        generate_streaming,
        text="hello",
        request=request,
        reference_wav_path=reference,
        cfg_value=2.0,
        inference_timesteps=10,
    )

    assert kwargs["reference_wav_path"] == str(reference)
    assert kwargs["prompt_wav_path"] == str(reference)
    assert kwargs["prompt_text"] == "hello"
    assert "reference_text" not in kwargs
    assert "control" not in kwargs


def test_voxcpm2_preset_uses_prompt_audio_and_transcript(tmp_path) -> None:
    reference = tmp_path / "preset_cantonese.wav"
    reference.write_bytes(b"RIFF")
    request = TtsSynthesizeRequest(
        text="你好",
        language="zh",
        speakerRole="guest",
        segmentId="seg_preset",
        voice={
            "mode": "preset",
            "presetId": "zh_female_cantonese",
            "referenceAudioId": "preset_cantonese",
            "referenceTranscript": "大家好，今日天气真系几好。",
        },
    )

    kwargs = voxcpm2_generate_kwargs(
        lambda **_kwargs: None,
        text=request.text,
        request=request,
        reference_wav_path=reference,
        cfg_value=2.0,
        inference_timesteps=10,
    )

    assert kwargs["prompt_wav_path"] == str(reference)
    assert kwargs["reference_wav_path"] == str(reference)
    assert kwargs["prompt_text"] == "大家好，今日天气真系几好。"


@pytest.mark.asyncio
async def test_voxcpm2_engine_resolves_reference_audio_id(tmp_path) -> None:
    reference = tmp_path / "my_voice.wav"
    reference.write_bytes(b"RIFF")
    model = FakeVoxCpmModel(sample_rate=48000, duration_seconds=1)
    engine = VoxCpm2TtsEngine(
        model_dir=str(tmp_path),
        cfg_value=2.0,
        inference_timesteps=10,
        load_denoiser=False,
        voice_reference_dir=str(tmp_path),
    )
    engine._model = model

    response = await engine.synthesize(TtsSynthesizeRequest(
        text="hello",
        language="en",
        speakerRole="guest",
        segmentId="seg_1",
        voice={
            "mode": "personal_clone",
            "voiceProfileId": "my_voice",
            "referenceAudioId": "my_voice",
        },
    ))

    assert response.voiceMode == "personal_clone"
    assert response.voiceProfileId == "my_voice"
    assert response.modelSampleRate == 48000
    assert response.outputSampleRate == 24000
    assert response.audio.sampleRate == 24000
    assert response.audioDurationMs == 1000
    assert model.kwargs["reference_wav_path"] == str(reference)


@pytest.mark.asyncio
@pytest.mark.parametrize(("quality", "expected_steps"), [
    ("standard", 10),
    ("hifi", 18),
])
async def test_voxcpm2_engine_selects_quality_inference_steps(
    tmp_path,
    quality: str,
    expected_steps: int,
) -> None:
    reference = tmp_path / "my_voice.wav"
    reference.write_bytes(b"RIFF")
    model = FakeVoxCpmModel()
    engine = VoxCpm2TtsEngine(
        model_dir=str(tmp_path),
        cfg_value=2.0,
        inference_timesteps=10,
        hifi_inference_timesteps=18,
        load_denoiser=False,
        voice_reference_dir=str(tmp_path),
    )
    engine._model = model

    await engine.synthesize(TtsSynthesizeRequest(
        text="hello",
        language="en",
        speakerRole="guest",
        segmentId=f"seg_{quality}",
        voice={
            "mode": "personal_clone",
            "voiceProfileId": "my_voice",
            "referenceAudioId": "my_voice",
            "quality": quality,
        },
    ))

    assert model.kwargs["inference_timesteps"] == expected_steps


def test_voxcpm2_health_rates_are_read_from_model_config(tmp_path) -> None:
    (tmp_path / "config.json").write_text(json.dumps({
        "audio_vae_config": {
            "sample_rate": 16000,
            "out_sample_rate": 48000,
        },
    }))
    engine = VoxCpm2TtsEngine(
        model_dir=str(tmp_path),
        cfg_value=2.0,
        inference_timesteps=10,
        load_denoiser=False,
    )

    assert engine.sample_rates() == (48000, 24000)


@pytest.mark.asyncio
async def test_voxcpm2_engine_converts_48k_model_audio_to_24k_protocol(tmp_path) -> None:
    model = FakeVoxCpmModel(sample_rate=48000, duration_seconds=1)
    engine = VoxCpm2TtsEngine(
        model_dir=str(tmp_path),
        cfg_value=2.0,
        inference_timesteps=10,
        load_denoiser=False,
    )
    engine._model = model

    response = await engine.synthesize(TtsSynthesizeRequest(
        text="hello",
        language="en",
        speakerRole="guest",
        segmentId="seg_48k",
    ))

    pcm = base64.b64decode(response.audio.data)
    assert response.modelSampleRate == 48000
    assert response.outputSampleRate == 24000
    assert response.audio.sampleRate == 24000
    assert response.audioDurationMs == 1000
    assert len(pcm) == 24000 * 2


@pytest.mark.asyncio
async def test_voxcpm2_engine_uses_retryable_complete_generation(tmp_path) -> None:
    model = FakeStreamingCapableVoxCpmModel()
    engine = VoxCpm2TtsEngine(
        model_dir=str(tmp_path),
        cfg_value=2.0,
        inference_timesteps=10,
        load_denoiser=False,
    )
    engine._model = model

    await engine.synthesize(TtsSynthesizeRequest(
        text="Settings.",
        language="en",
        speakerRole="guest",
        segmentId="seg_badcase_guard",
    ))

    assert model.generate_calls == 1
    assert model.streaming_calls == 0
    assert model.kwargs["retry_badcase"] is True
    assert model.kwargs["retry_badcase_max_times"] == 3
    assert model.kwargs["retry_badcase_ratio_threshold"] == 6.0


@pytest.mark.asyncio
async def test_voxcpm2_engine_streams_model_chunks_without_complete_generation(
    tmp_path,
) -> None:
    model = FakeStreamingCapableVoxCpmModel()
    engine = VoxCpm2TtsEngine(
        model_dir=str(tmp_path),
        cfg_value=2.0,
        inference_timesteps=10,
        load_denoiser=False,
    )
    engine._model = model

    events = [event async for event in engine.synthesize_stream(
        TtsSynthesizeRequest(
            text="Streaming.",
            language="en",
            speakerRole="guest",
            segmentId="seg_streaming",
        ),
    )]

    assert model.generate_calls == 0
    assert model.streaming_calls == 1
    assert [event["type"] for event in events] == [
        "metadata", "audio_chunk", "final",
    ]
    assert events[1]["sequence"] == 1
    assert events[2]["audioDurationMs"] >= 1


class FakeTtsModel:
    def __init__(self, sample_rate: int) -> None:
        self.sample_rate = sample_rate


class FakeVoxCpmModel:
    def __init__(self, sample_rate: int = 24000, duration_seconds: int = 0) -> None:
        self.tts_model = FakeTtsModel(sample_rate)
        self.duration_seconds = duration_seconds
        self.kwargs = {}

    def generate(self, **kwargs):
        self.kwargs = kwargs
        if self.duration_seconds:
            return [
                0.5 * math.sin(2 * math.pi * 440 * index / self.tts_model.sample_rate)
                for index in range(self.tts_model.sample_rate * self.duration_seconds)
            ]
        return [0.0, 0.1, -0.1]


class FakeStreamingCapableVoxCpmModel(FakeVoxCpmModel):
    def __init__(self) -> None:
        super().__init__()
        self.generate_calls = 0
        self.streaming_calls = 0

    def generate(self, **kwargs):
        self.generate_calls += 1
        return super().generate(**kwargs)

    def generate_streaming(self, **kwargs):
        self.streaming_calls += 1
        yield super().generate(**kwargs)
