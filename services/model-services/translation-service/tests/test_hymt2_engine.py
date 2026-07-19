from app.hymt2_engine import as_model_inputs, build_prompt


def test_hymt2_model_inputs_drop_unsupported_token_type_ids() -> None:
    inputs = {
        "input_ids": object(),
        "attention_mask": object(),
        "token_type_ids": object(),
    }

    model_inputs = as_model_inputs(inputs)

    assert set(model_inputs) == {"input_ids", "attention_mask"}


def test_hymt2_prompt_uses_requested_non_english_target_language() -> None:
    prompt = build_prompt("你好", "ja")

    assert "日语" in prompt
    assert "简体中文" not in prompt


def test_hymt2_prompt_keeps_traditional_chinese_target_language() -> None:
    prompt = build_prompt("你好", "zh-Hant")

    assert "繁体中文" in prompt


def test_hymt2_prompt_uses_context_glossary_and_protected_entities() -> None:
    prompt = build_prompt(
        "SKU A-120 是 LiveKit trunk。",
        "en",
        previous_segments=(("上一句", "Previous sentence"),),
        glossary=(("中继", "trunk"),),
        protected_entities=("A-120", "LiveKit"),
    )

    assert "【背景信息】" in prompt
    assert "对应译文：Previous sentence" in prompt
    assert "中继 翻译成 trunk" in prompt
    assert "A-120 翻译成 A-120" in prompt
    assert "LiveKit 翻译成 LiveKit" in prompt
