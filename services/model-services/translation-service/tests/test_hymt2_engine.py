from app.hymt2_engine import build_prompt


def test_hymt2_prompt_uses_requested_non_english_target_language() -> None:
    prompt = build_prompt("你好", "ja")

    assert "日语" in prompt
    assert "简体中文" not in prompt


def test_hymt2_prompt_keeps_traditional_chinese_target_language() -> None:
    prompt = build_prompt("你好", "zh-Hant")

    assert "繁体中文" in prompt
