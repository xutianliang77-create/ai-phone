import base64
import struct

from app.schemas import AsrTranscribeRequest


class PcmSessionBuffer:
    def __init__(self, min_audio_ms: int) -> None:
        self.min_audio_ms = min_audio_ms
        self._chunks_by_session: dict[str, list[bytes]] = {}
        self._seen_sequences: dict[str, set[int]] = {}

    def append(self, request: AsrTranscribeRequest) -> bytes | None:
        seen = self._seen_sequences.setdefault(request.sessionId, set())
        if request.sequence in seen:
            return None
        seen.add(request.sequence)

        chunk = base64.b64decode(request.data, validate=True)
        chunks = self._chunks_by_session.setdefault(request.sessionId, [])
        chunks.append(chunk)
        if audio_duration_ms(b"".join(chunks), request.sampleRate) < self.min_audio_ms:
            return None

        audio = b"".join(chunks)
        self._chunks_by_session[request.sessionId] = []
        return audio


def audio_duration_ms(pcm: bytes, sample_rate: int) -> int:
    if sample_rate <= 0:
        return 0
    return len(pcm) * 1000 // (sample_rate * 2)


def pcm16_rms(pcm: bytes) -> int:
    even_length = len(pcm) - (len(pcm) % 2)
    if even_length == 0:
        return 0

    total = 0
    count = 0
    for (sample,) in struct.iter_unpack("<h", pcm[:even_length]):
        total += sample * sample
        count += 1
    if count == 0:
        return 0
    return int((total / count) ** 0.5)
