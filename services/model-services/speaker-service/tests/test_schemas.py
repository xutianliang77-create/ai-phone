from app.schemas import SpeakerOptions


def test_speaker_options_default_to_model_capacity() -> None:
    options = SpeakerOptions(mode="auto")

    assert options.maxSpeakers == 4


def test_speaker_options_normalize_old_client_capacity() -> None:
    options = SpeakerOptions(mode="diarization", maxSpeakers=2)

    assert options.maxSpeakers == 4
