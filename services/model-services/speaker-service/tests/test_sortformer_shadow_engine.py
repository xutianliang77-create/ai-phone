from array import array

import pytest

from app.pcm_stream_buffer import PcmStreamBuffer
from app.speaker_activity_decoder import SpeakerActivityDecoder


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
