import base64
import struct

import numpy as np

from candidate_service.vad import VadDecision


class FakeState:
    def __init__(self) -> None:
        self.calls = 0
        self.language = "Spanish"


class FakeQwen:
    def __init__(self) -> None:
        self.batch_calls = 0
        self.last_final_samples = 0
        self.final_sample_history: list[int] = []

    def new_state(self, _source_language: str):
        return FakeState()

    def push(self, state, _audio: np.ndarray):
        state.calls += 1
        texts = {
            1: "No",
            2: "No carga",
            3: "No carga y y tampoco",
        }
        return state.calls, texts.get(state.calls, texts[3]), state.language

    def finish(self, state):
        return "No carga y y tampoco.", state.language

    def transcribe_final(
        self,
        audio: np.ndarray,
        _source_language: str,
        _detected_language: str,
    ):
        self.batch_calls += 1
        self.last_final_samples = len(audio)
        self.final_sample_history.append(len(audio))
        return "No carga y y tampoco.", "Spanish"


class FailingBatchQwen(FakeQwen):
    def transcribe_final(
        self,
        _audio: np.ndarray,
        _source_language: str,
        _detected_language: str,
    ):
        raise RuntimeError("batch failed")


class FakeMoss:
    def transcribe(self, _audio: np.ndarray):
        return "No carga y tampoco. Cola equivocada.", 1


class FixedFinalQwen(FakeQwen):
    def __init__(self, text: str) -> None:
        super().__init__()
        self.text = text

    def transcribe_final(
        self,
        audio: np.ndarray,
        _source_language: str,
        _detected_language: str,
    ):
        self.batch_calls += 1
        self.last_final_samples = len(audio)
        self.final_sample_history.append(len(audio))
        return self.text, "Chinese"


class WeakProbabilityVad:
    def analyze(
        self,
        _session_id: str,
        pcm: np.ndarray,
        _sample_rate: int,
    ) -> VadDecision:
        voiced = bool(np.max(np.abs(pcm), initial=0) > 0)
        return VadDecision(voiced, 0.2 if voiced else 0.01, "fake")

    def diagnostics(self, _session_id: str) -> dict[str, object]:
        return {}

    def health_diagnostics(self) -> dict[str, object]:
        return {"activeProvider": "fake"}

    def close_session(self, _session_id: str) -> None:
        return None


class FakeMarbleNet:
    def speech_probability(
        self,
        pcm: bytes,
        _sample_rate: int,
        _current_duration_ms: int,
        _smoothing_frames: int,
    ) -> float:
        samples = np.frombuffer(pcm, dtype="<i2")
        return 0.9 if np.max(np.abs(samples), initial=0) > 0 else 0.1


def frame(
    sequence: int,
    amplitude: int,
    *,
    session_id: str = "session-1",
) -> dict[str, object]:
    samples = [amplitude] * 1600
    pcm = b"".join(struct.pack("<h", value) for value in samples)
    return {
        "sessionId": session_id,
        "sequence": sequence,
        "timestampMs": sequence * 100,
        "format": "pcm16",
        "sampleRate": 16000,
        "data": base64.b64encode(pcm).decode(),
        "sourceLanguage": "auto",
        "targetLanguage": "zh",
        "mode": "listening",
    }
