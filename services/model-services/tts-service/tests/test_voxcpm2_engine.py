import pytest

from app.schemas import TtsSynthesizeRequest
from app.voxcpm2_engine import (
    VoxCpm2TtsEngine,
    build_voxcpm2_text,
    parse_sample_rate,
    voxcpm2_generate_kwargs,
)


def test_voxcpm2_text_uses_language_prompt() -> None:
    assert build_voxcpm2_text("你好", "zh").startswith(
        "(A clear, warm Mandarin voice for phone translation)"
    )
    assert build_voxcpm2_text("hello", "en").startswith(
        "(A clear, warm English voice for phone translation)"
    )


def test_parse_sample_rate_keeps_supported_rates() -> None:
    assert parse_sample_rate(16000) == 16000
    assert parse_sample_rate(24000) == 24000


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


@pytest.mark.asyncio
async def test_voxcpm2_engine_resolves_reference_audio_id(tmp_path) -> None:
    reference = tmp_path / "my_voice.wav"
    reference.write_bytes(b"RIFF")
    model = FakeVoxCpmModel()
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
    assert model.kwargs["reference_wav_path"] == str(reference)


class FakeTtsModel:
    sample_rate = 24000


class FakeVoxCpmModel:
    tts_model = FakeTtsModel()

    def __init__(self) -> None:
        self.kwargs = {}

    def generate(self, **kwargs):
        self.kwargs = kwargs
        return [0.0, 0.1, -0.1]
