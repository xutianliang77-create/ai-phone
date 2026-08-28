import json
import struct


def payload(sequence: int) -> dict:
    return {
        "sessionId": "sess_1",
        "sequence": sequence,
        "timestampMs": sequence,
        "format": "pcm16",
        "sampleRate": 24000,
        "data": "AA==",
        "sourceLanguage": "en",
        "targetLanguage": "zh",
    }


def flush_payload() -> dict:
    return {
        "sourceLanguage": "en",
        "targetLanguage": "zh",
    }


def stream_frame(sequence: int, request_id: str) -> bytes:
    header = json.dumps({
        "type": "audio.frame",
        "requestId": request_id,
        "sequence": sequence,
        "timestampMs": sequence * 100,
        "format": "pcm16",
        "sampleRate": 24000,
    }).encode("utf-8")
    return struct.pack(">I", len(header)) + header + b"\x00\x00"
