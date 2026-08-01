import pytest

from app.config import load_config


def test_session_alias_provider_is_disabled_by_default(monkeypatch) -> None:
    monkeypatch.delenv("SESSION_SPEAKER_ALIAS_PROVIDER", raising=False)
    monkeypatch.delenv("SESSION_SPEAKER_ALIAS_MINIMUM_EVIDENCE_MS", raising=False)

    config = load_config()

    assert config.session_alias_provider == "off"
    assert config.session_alias_minimum_evidence_ms == 1500


def test_rejects_unknown_session_alias_provider(monkeypatch) -> None:
    monkeypatch.setenv("SESSION_SPEAKER_ALIAS_PROVIDER", "unsafe")

    with pytest.raises(
        ValueError,
        match="Unsupported session speaker alias provider",
    ):
        load_config()


def test_reads_pending_speaker_activation_duration(monkeypatch) -> None:
    monkeypatch.setenv("SPEAKER_MIN_DURATION_ON_MS", "100")

    assert load_config().min_duration_on_ms == 100
