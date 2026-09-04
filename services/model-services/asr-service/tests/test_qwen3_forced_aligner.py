from dataclasses import dataclass

import pytest

from app.qwen3_forced_aligner import validated_tokens


@dataclass(frozen=True)
class Item:
    text: str
    start_time: float
    end_time: float
    confidence: float | None = None


@dataclass(frozen=True)
class Result:
    items: tuple[Item, ...]


def test_validates_timing_and_maps_character_ranges() -> None:
    tokens = validated_tokens(
        Result((
            Item("Qwen3-ASR", 0.02, 0.42, 0.9),
            Item("测试", 0.44, 0.76),
        )),
        "Qwen3-ASR测试",
        800,
    )

    assert tokens[0].start_ms == 20
    assert tokens[0].end_ms == 420
    assert tokens[0].character_start == 0
    assert tokens[0].character_end == 9
    assert tokens[1].character_start == 9
    assert tokens[1].character_end == 11


def test_rejects_non_monotonic_or_out_of_window_alignment() -> None:
    with pytest.raises(RuntimeError, match="invalid timing"):
        validated_tokens(
            Result((Item("后", 0.5, 0.7), Item("前", 0.4, 0.6))),
            "后前",
            800,
        )
    with pytest.raises(RuntimeError, match="invalid timing"):
        validated_tokens(Result((Item("越界", 0.1, 1.2),)), "越界", 800)
