from app.config import AsrConfig


def test_vllm_runtime_fingerprint_contains_the_frozen_partial_policy() -> None:
    parameters = AsrConfig(provider="qwen3_asr_vllm").runtime_parameters()

    assert parameters["listeningStablePartial"] == {
        "enabled": False,
        "languageGate": "zh_or_auto_detected_zh",
        "decodeScheduleMs": [500, 700, 900, 1000],
        "steadyDecodeMs": 1000,
        "minimumReadableUnits": 2,
        "minimumPushAudioMs": 40,
        "extensionSurvivalDecodes": 1,
        "unfixedChunkNum": 4,
        "unfixedTokenNum": 5,
    }


def test_stable_partial_toggle_changes_only_the_vllm_effective_identity() -> None:
    vllm = AsrConfig(
        provider="qwen3_asr_vllm",
        qwen3_listening_stable_partial_enabled=True,
    )
    hf = AsrConfig(
        provider="qwen3_asr_hf",
        qwen3_listening_stable_partial_enabled=True,
    )

    assert vllm.runtime_parameters()["listeningStablePartial"]["enabled"] is True
    assert hf.runtime_parameters()["listeningStablePartial"]["enabled"] is False
