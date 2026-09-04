import base64
import struct

from app.audio_buffer import RealtimePcmSegmenter
from app.schemas import AsrTranscribeRequest


def test_realtime_segmenter_exposes_only_the_active_audio_window() -> None:
    segmenter = RealtimePcmSegmenter(
        min_audio_ms=1000,
        endpoint_silence_ms=1000,
        max_audio_ms=2000,
        preroll_ms=40,
        vad_energy_threshold=350,
    )

    assert segmenter.active_audio("sess_1") is None
    segmenter.append(request(1, silence_pcm(), 1000))
    assert segmenter.active_audio("sess_1") is None
    segmenter.append(request(2, voice_pcm(), 1040))

    active = segmenter.active_audio("sess_1")
    assert active is not None
    assert active.pcm == silence_pcm() + voice_pcm()
    assert active.sample_rate == 24000
    assert active.start_sequence == 1
    assert active.end_sequence == 2
    assert active.duration_ms == 80
    assert active.start_timestamp_ms == 1000
    assert active.end_timestamp_ms == 1080


def request(sequence: int, pcm: bytes, timestamp_ms: int) -> AsrTranscribeRequest:
    return AsrTranscribeRequest(
        sessionId="sess_1",
        sequence=sequence,
        timestampMs=timestamp_ms,
        format="pcm16",
        sampleRate=24000,
        data=base64.b64encode(pcm).decode("ascii"),
        sourceLanguage="zh",
        targetLanguage="en",
    )


def silence_pcm() -> bytes:
    return b"\0" * 1920


def voice_pcm() -> bytes:
    return struct.pack("<" + "h" * 960, *([1000] * 960))
