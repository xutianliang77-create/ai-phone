import base64
import struct

from app.audio_buffer import PcmSessionBuffer, RealtimePcmSegmenter, audio_duration_ms
from app.schemas import AsrTranscribeRequest


def test_audio_duration_ms_for_pcm16_mono() -> None:
    assert audio_duration_ms(b"\0" * 1920, 24000) == 40


def test_buffer_returns_audio_after_min_duration() -> None:
    buffer = PcmSessionBuffer(min_audio_ms=80)

    first = buffer.append(request(sequence=1))
    second = buffer.append(request(sequence=2))

    assert first is None
    assert second == b"\0" * 3840


def test_buffer_ignores_duplicate_sequences() -> None:
    buffer = PcmSessionBuffer(min_audio_ms=40)

    buffer.append(request(sequence=1))
    duplicate = buffer.append(request(sequence=1))

    assert duplicate is None


def test_realtime_segmenter_waits_for_voice() -> None:
    segmenter = realtime_segmenter()

    segment = segmenter.append(request(sequence=1, pcm=silence_pcm()))

    assert segment is None


def test_realtime_segmenter_emits_after_endpoint_silence() -> None:
    segmenter = realtime_segmenter(min_audio_ms=120, endpoint_silence_ms=80)

    assert segmenter.append(request(sequence=1, pcm=voice_pcm())) is None
    assert segmenter.append(request(sequence=2, pcm=silence_pcm())) is None
    segment = segmenter.append(request(sequence=3, pcm=silence_pcm()))

    assert segment is not None
    assert segment.end_sequence == 3
    assert segment.duration_ms == 120
    assert segment.pcm == voice_pcm() + silence_pcm() * 2


def test_realtime_segmenter_flushes_at_max_window() -> None:
    segmenter = realtime_segmenter(
        min_audio_ms=1000,
        endpoint_silence_ms=1000,
        max_audio_ms=120,
    )

    assert segmenter.append(request(sequence=1, pcm=voice_pcm())) is None
    assert segmenter.append(request(sequence=2, pcm=voice_pcm())) is None
    segment = segmenter.append(request(sequence=3, pcm=voice_pcm()))

    assert segment is not None
    assert segment.duration_ms == 120


def test_realtime_segmenter_flushes_active_speech() -> None:
    segmenter = realtime_segmenter(min_audio_ms=1000, endpoint_silence_ms=1000)

    assert segmenter.append(request(sequence=1, pcm=voice_pcm())) is None
    segment = segmenter.flush("sess_1")

    assert segment is not None
    assert segment.end_sequence == 1
    assert segment.duration_ms == 40
    assert segment.pcm == voice_pcm()


def test_realtime_segmenter_does_not_flush_leading_silence() -> None:
    segmenter = realtime_segmenter(min_audio_ms=1000, endpoint_silence_ms=1000)

    assert segmenter.append(request(sequence=1, pcm=silence_pcm())) is None

    assert segmenter.flush("sess_1") is None


def test_realtime_segmenter_ignores_duplicate_sequences() -> None:
    segmenter = realtime_segmenter(min_audio_ms=40, endpoint_silence_ms=0)

    first = segmenter.append(request(sequence=1, pcm=voice_pcm()))
    duplicate = segmenter.append(request(sequence=1, pcm=voice_pcm()))

    assert first is not None
    assert duplicate is None


def realtime_segmenter(
    min_audio_ms: int = 120,
    endpoint_silence_ms: int = 80,
    max_audio_ms: int = 1000,
) -> RealtimePcmSegmenter:
    return RealtimePcmSegmenter(
        min_audio_ms=min_audio_ms,
        endpoint_silence_ms=endpoint_silence_ms,
        max_audio_ms=max_audio_ms,
        preroll_ms=40,
        vad_energy_threshold=350,
    )


def silence_pcm() -> bytes:
    return b"\0" * 1920


def voice_pcm(amplitude: int = 1000) -> bytes:
    return struct.pack("<" + "h" * 960, *([amplitude] * 960))


def request(sequence: int, pcm: bytes | None = None) -> AsrTranscribeRequest:
    audio = pcm or silence_pcm()
    return AsrTranscribeRequest(
        sessionId="sess_1",
        sequence=sequence,
        timestampMs=sequence,
        format="pcm16",
        sampleRate=24000,
        data=base64.b64encode(audio).decode("ascii"),
        sourceLanguage="en",
        targetLanguage="zh",
    )
