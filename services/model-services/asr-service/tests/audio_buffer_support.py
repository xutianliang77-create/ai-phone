import base64
import struct

from app.audio_buffer import RealtimePcmSegmenter
from app.schemas import AsrTranscribeRequest
from app.vad import VadDecision


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


def request(
    sequence: int,
    pcm: bytes | None = None,
    timestamp_ms: int | None = None,
    session_id: str = "sess_1",
    mode: str = "conversation",
) -> AsrTranscribeRequest:
    audio = pcm or silence_pcm()
    return AsrTranscribeRequest(
        sessionId=session_id,
        sequence=sequence,
        timestampMs=timestamp_ms if timestamp_ms is not None else sequence,
        format="pcm16",
        sampleRate=24000,
        data=base64.b64encode(audio).decode("ascii"),
        sourceLanguage="en",
        targetLanguage="zh",
        mode=mode,
    )


class TrackingVadProvider:
    name = "tracking"

    def __init__(self) -> None:
        self.reset_count = 0

    def analyze(
        self,
        session_id: str,
        pcm: bytes,
        sample_rate: int,
        threshold: float | None = None,
    ):
        return VadDecision(voiced=True, probability=0.9, provider=self.name)

    def reset_session(self, session_id: str) -> None:
        self.reset_count += 1

    def close_session(self, session_id: str) -> None:
        pass

    def diagnostics(self, session_id: str):
        return {}


class ThresholdAwareVadProvider(TrackingVadProvider):
    def __init__(self, probability: float) -> None:
        super().__init__()
        self.probability = probability
        self.thresholds: dict[str, float | None] = {}

    def analyze(
        self,
        session_id: str,
        pcm: bytes,
        sample_rate: int,
        threshold: float | None = None,
    ):
        del pcm, sample_rate
        self.thresholds[session_id] = threshold
        effective_threshold = 0.5 if threshold is None else threshold
        return VadDecision(
            voiced=self.probability >= effective_threshold,
            probability=self.probability,
            provider=self.name,
        )

    def diagnostics(self, session_id: str):
        return {"threshold": self.thresholds.get(session_id)}
