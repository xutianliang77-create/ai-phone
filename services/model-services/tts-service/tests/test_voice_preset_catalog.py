import json

import pytest

from app.schemas import TtsSynthesizeRequest
from app.voice_preset_catalog import VoicePresetCatalog


def test_catalog_only_exposes_presets_with_server_assets(tmp_path) -> None:
    (tmp_path / "preset_ready.wav").write_bytes(b"RIFF-ready")
    manifest = tmp_path / "presets.json"
    manifest.write_text(json.dumps({
        "version": "catalog-v1",
        "defaultPresetId": "ready",
        "presets": [
            preset("ready", "preset_ready"),
            preset("missing", "preset_missing"),
        ],
    }), encoding="utf-8")

    catalog = VoicePresetCatalog.load(str(manifest), str(tmp_path))
    response = catalog.response()

    assert response.version == "catalog-v1"
    assert response.defaultPresetId == "ready"
    assert [item.id for item in response.presets] == ["ready"]
    assert response.presets[0].labels == {"zh": "测试音色", "en": "Test voice"}


def test_catalog_resolves_default_preset_to_fixed_reference(tmp_path) -> None:
    (tmp_path / "preset_ready.wav").write_bytes(b"RIFF-ready")
    manifest = tmp_path / "presets.json"
    manifest.write_text(json.dumps({
        "version": "catalog-v1",
        "defaultPresetId": "ready",
        "presets": [preset("ready", "preset_ready")],
    }), encoding="utf-8")
    catalog = VoicePresetCatalog.load(str(manifest), str(tmp_path))

    resolved = catalog.resolve_request(request())

    assert resolved.voice is not None
    assert resolved.voice.mode == "preset"
    assert resolved.voice.presetId == "ready"
    assert resolved.voice.voiceProfileId == "ready"
    assert resolved.voice.referenceAudioId == "preset_ready"
    assert resolved.voice.referenceTranscript == "这是一段参考语音。"


def test_catalog_rejects_unknown_preset(tmp_path) -> None:
    (tmp_path / "preset_ready.wav").write_bytes(b"RIFF-ready")
    manifest = tmp_path / "presets.json"
    manifest.write_text(json.dumps({
        "version": "catalog-v1",
        "presets": [preset("ready", "preset_ready")],
    }), encoding="utf-8")
    catalog = VoicePresetCatalog.load(str(manifest), str(tmp_path))

    with pytest.raises(ValueError, match="Unsupported natural voice preset"):
        catalog.resolve_request(request("missing"))


def preset(preset_id: str, reference_audio_id: str) -> dict:
    return {
        "id": preset_id,
        "labels": {"zh": "测试音色", "en": "Test voice"},
        "gender": "female",
        "tone": "natural",
        "scenario": "conversation",
        "accent": "mandarin",
        "languages": ["zh", "en"],
        "referenceAudioId": reference_audio_id,
        "referenceText": "这是一段参考语音。",
    }


def request(preset_id: str | None = None) -> TtsSynthesizeRequest:
    return TtsSynthesizeRequest(
        text="hello",
        language="en",
        speakerRole="guest",
        segmentId="seg_1",
        voice={
            "mode": "preset",
            **({"presetId": preset_id} if preset_id else {}),
        },
    )
