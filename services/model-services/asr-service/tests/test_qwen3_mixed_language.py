from app.qwen3_mixed_language import (
    select_mixed_language_candidate,
    should_retry_mixed_language,
)


def test_retry_is_limited_to_auto_chinese_only_results() -> None:
    assert should_retry_mixed_language("auto", "你叫什么名字？")
    assert not should_retry_mixed_language("zh", "你叫什么名字？")
    assert not should_retry_mixed_language("auto", "What's your name?你叫什么名字？")
    assert not should_retry_mixed_language("auto", "你？")


def test_candidate_accepts_english_prefix_with_same_chinese_suffix() -> None:
    assert select_mixed_language_candidate(
        "你叫什么名字？",
        "What's your name?你叫什么名字？",
    ) == "What's your name?你叫什么名字？"


def test_candidate_rejects_translated_chinese() -> None:
    assert select_mixed_language_candidate(
        "你叫什么名字？",
        "What is your name?",
    ) == "你叫什么名字？"


def test_candidate_rejects_changed_chinese_suffix() -> None:
    assert select_mixed_language_candidate(
        "你叫什么名字？",
        "What's your name?你叫什么名子？",
    ) == "你叫什么名字？"
