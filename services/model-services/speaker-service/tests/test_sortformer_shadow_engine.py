from array import array
import base64

import pytest

from app.pcm_stream_buffer import PcmStreamBuffer
from app.speaker_activity_decoder import SpeakerActivityDecoder
from app.schemas import SpeakerAudioFrame
from app.sortformer_shadow_engine import SortformerShadowEngine, _Session


def test_decoder_keeps_arrival_order_and_marks_overlap() -> None:
    decoder = SpeakerActivityDecoder(
        max_speakers=2,
        timeline_origin_ms=1000,
    )

    spans = decoder.consume([
        [0.9, 0.1],
        [0.8, 0.1],
        [0.8, 0.9],
        [0.1, 0.8],
        [0.1, 0.1],
    ], start_frame=0)

    assert [(item.speakerId, item.startMs, item.endMs, item.overlap) for item in spans] == [
        ("speaker_1", 1000, 1160, False),
        ("speaker_1", 1160, 1240, True),
        ("speaker_2", 1160, 1240, True),
        ("speaker_2", 1240, 1320, False),
    ]


def test_decoder_rejects_non_contiguous_probabilities() -> None:
    decoder = SpeakerActivityDecoder(max_speakers=2, timeline_origin_ms=0)
    decoder.consume([[0.1, 0.1]], start_frame=0)

    with pytest.raises(ValueError, match="contiguous"):
        decoder.consume([[0.1, 0.1]], start_frame=2)


def test_decoder_exposes_active_span_without_closing_it() -> None:
    decoder = SpeakerActivityDecoder(max_speakers=2, timeline_origin_ms=1000)
    assert decoder.consume([[0.9, 0.1], [0.8, 0.1]], start_frame=0) == []

    active = decoder.active_spans()
    closed = decoder.consume([[0.1, 0.1]], start_frame=2)

    assert [(item.startMs, item.endMs, item.final) for item in active] == [
        (1000, 1160, False),
    ]
    assert [(item.startMs, item.endMs, item.final) for item in closed] == [
        (1000, 1160, True),
    ]

    decoder.align_next_frame(5000)
    decoder.consume([[0.9, 0.1]], start_frame=3)
    assert decoder.active_spans()[0].startMs == 5000


def test_decoder_bridges_a_short_speaker_gap() -> None:
    decoder = SpeakerActivityDecoder(
        max_speakers=2,
        timeline_origin_ms=0,
        onset=0.56,
        offset=0.56,
        pad_offset_ms=20,
        min_duration_off_ms=320,
    )

    spans = decoder.consume([
        [0.9, 0.1],
        [0.1, 0.1],
        [0.1, 0.1],
        [0.1, 0.1],
        [0.9, 0.1],
    ], start_frame=0)

    assert spans == []
    assert decoder.flush()[0].model_dump() == {
        "speakerId": "speaker_1",
        "startMs": 0,
        "endMs": 400,
        "confidence": 0.9,
        "overlap": False,
        "final": True,
    }


def test_decoder_confirms_a_long_gap_without_delaying_new_speaker() -> None:
    decoder = SpeakerActivityDecoder(
        max_speakers=2,
        timeline_origin_ms=0,
        onset=0.56,
        offset=0.56,
        pad_offset_ms=20,
        min_duration_off_ms=320,
    )

    spans = decoder.consume([
        [0.9, 0.1],
        [0.1, 0.9],
        [0.1, 0.8],
        [0.1, 0.8],
        [0.1, 0.8],
        [0.1, 0.8],
    ], start_frame=0)

    assert [(item.speakerId, item.startMs, item.endMs, item.overlap) for item in spans] == [
        ("speaker_1", 0, 100, False),
    ]
    assert decoder.active_spans()[0].model_dump() == {
        "speakerId": "speaker_2",
        "startMs": 80,
        "endMs": 480,
        "confidence": 0.82,
        "overlap": False,
        "final": False,
    }


def test_decoder_keeps_a_one_frame_new_speaker_pending() -> None:
    decoder = SpeakerActivityDecoder(
        max_speakers=2,
        timeline_origin_ms=0,
        min_duration_on_ms=100,
    )

    assert decoder.consume([[0.9, 0.1]], start_frame=0) == []
    assert decoder.active_spans() == []
    assert decoder.consume([[0.1, 0.1]], start_frame=1) == []
    assert decoder.flush() == []


def test_decoder_backfills_a_confirmed_pending_speaker_start() -> None:
    decoder = SpeakerActivityDecoder(
        max_speakers=2,
        timeline_origin_ms=1000,
        min_duration_on_ms=100,
    )

    assert decoder.consume([[0.9, 0.1]], start_frame=0) == []
    assert decoder.consume([[0.8, 0.1]], start_frame=1) == []

    confirmed = decoder.active_spans()[0].model_dump()
    assert confirmed == {
        "speakerId": "speaker_1",
        "startMs": 1000,
        "endMs": 1160,
        "confidence": confirmed["confidence"],
        "overlap": False,
        "final": False,
    }
    assert confirmed["confidence"] == pytest.approx(0.85)


def test_decoder_does_not_publish_pending_overlap() -> None:
    decoder = SpeakerActivityDecoder(
        max_speakers=2,
        timeline_origin_ms=0,
        min_duration_on_ms=100,
    )
    decoder.consume([[0.9, 0.1], [0.9, 0.1]], start_frame=0)

    decoder.consume([[0.9, 0.9]], start_frame=2)

    assert [
        (item.speakerId, item.overlap)
        for item in decoder.active_spans()
    ] == [("speaker_1", False)]


def test_pcm_buffer_resamples_24khz_as_one_continuous_stream() -> None:
    buffer = PcmStreamBuffer()
    source = array("h", [1000, -1000] * 12000).tobytes()

    buffer.append(source[:24000], sample_rate=24000)
    buffer.append(source[24000:], sample_rate=24000)
    buffer.finalize()

    assert abs(buffer.end_sample - 16000) <= 1
    samples = buffer.samples(0, min(16000, buffer.end_sample))
    assert samples.size >= 15999
    buffer.discard_before(8000)
    assert buffer.start_sample == 8000


def test_pcm_buffer_can_reset_input_stream_at_resume_boundary() -> None:
    buffer = PcmStreamBuffer()
    source = array("h", [1000, -1000] * 2400).tobytes()
    buffer.append(source, sample_rate=24000)
    boundary = buffer.end_sample - 20

    buffer.prepare_for_resume(boundary)
    buffer.append(source, sample_rate=24000)

    assert buffer.start_sample == 0
    assert buffer.end_sample > boundary


def test_sortformer_engine_ignores_duplicate_or_out_of_order_frames() -> None:
    engine = SortformerShadowEngine.__new__(SortformerShadowEngine)
    engine._onset = 0.5
    engine._offset = 0.5
    engine._pad_offset_ms = 0
    engine._min_duration_on_ms = 0
    engine._min_duration_off_ms = 0
    session = _Session(max_speakers=4, runtime_state=None)

    assert engine._append(session, _frame(sequence=2)) is True
    end_sample = session.audio.end_sample

    assert engine._append(session, _frame(sequence=2)) is False
    assert engine._append(session, _frame(sequence=1)) is False
    assert session.audio.end_sample == end_sample


def _frame(sequence: int) -> SpeakerAudioFrame:
    return SpeakerAudioFrame(
        type="audio.frame",
        sessionId="sess_1",
        sequence=sequence,
        timestampMs=sequence * 100,
        format="pcm16",
        sampleRate=24000,
        data=base64.b64encode(array("h", [0] * 2400).tobytes()).decode(),
    )
