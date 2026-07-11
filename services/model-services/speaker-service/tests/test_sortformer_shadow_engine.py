from app.schemas import SpeakerSpan
from app.sortformer_shadow_engine import (
    _Session,
    finalize_new_spans,
    stabilize_speaker_labels,
    trim_rolling_context,
)


def span(speaker: str, start: int, end: int) -> SpeakerSpan:
    return SpeakerSpan(speakerId=speaker, startMs=start, endMs=end)


def test_stabilizes_labels_when_local_order_changes() -> None:
    previous = [span("speaker_1", 0, 2000), span("speaker_2", 2000, 4000)]
    current = [span("local_2", 1000, 2200), span("local_1", 2200, 5000)]

    mapped, mapping, _ = stabilize_speaker_labels(current, previous, {}, 3)

    assert mapping == {"local_1": "speaker_2", "local_2": "speaker_1"}
    assert [item.speakerId for item in mapped] == ["speaker_1", "speaker_2"]


def test_only_emits_new_stable_timeline_region() -> None:
    spans = [span("speaker_1", 800, 1600), span("speaker_2", 1600, 2600)]

    result = finalize_new_spans(spans, previous_boundary=1200, stable_end=2200)

    assert result == [
        span("speaker_1", 1200, 1600),
        span("speaker_2", 1600, 2200),
    ]


def test_never_allocates_more_than_configured_speaker_slots() -> None:
    current = [span(f"local_{index}", 0, 1000) for index in range(1, 6)]

    mapped, mapping, _ = stabilize_speaker_labels(
        current,
        previous=[],
        previous_mapping={},
        next_speaker_index=1,
        max_speakers=4,
    )

    assert len(mapping) == 4
    assert {item.speakerId for item in mapped} == {
        "speaker_1", "speaker_2", "speaker_3", "speaker_4",
    }


def test_trims_pcm_and_timeline_to_rolling_context() -> None:
    session = _Session(
        sample_rate=1000,
        pcm=bytearray(10_000),
        buffer_start_ms=2000,
        buffer_duration_ms=5000,
        previous_spans=[
            span("speaker_1", 2000, 3500),
            span("speaker_2", 3500, 7000),
        ],
    )

    trim_rolling_context(session, max_context_ms=3000)

    assert len(session.pcm) == 6000
    assert session.buffer_start_ms == 4000
    assert session.buffer_duration_ms == 3000
    assert session.previous_spans == [span("speaker_2", 3500, 7000)]
