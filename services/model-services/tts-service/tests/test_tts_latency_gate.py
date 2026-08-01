import io
import importlib.util
from pathlib import Path

import pytest


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "tts_latency_gate.py"
SPEC = importlib.util.spec_from_file_location("tts_latency_gate", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
consume_stream = MODULE.consume_stream


class FakeClock:
    def __init__(self, *values: float) -> None:
        self.values = iter(values)

    def __call__(self) -> float:
        return next(self.values)


def test_stream_gate_measures_playable_chunk_at_the_client_boundary() -> None:
    response = io.BytesIO(
        b'{"type":"metadata","firstAudioMs":22}\n'
        b'{"type":"audio_chunk","sequence":1,"data":"AA=="}\n'
        b'{"type":"final","audioDurationMs":320}\n'
    )

    result = consume_stream(response, 10.0, FakeClock(10.031, 10.240))

    assert result == {
        "wallMs": 240,
        "modelFirstAudioMs": 22,
        "firstAudioMs": 31,
    }


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (
            b'{"type":"metadata","firstAudioMs":22}\n'
            b'{"type":"final","audioDurationMs":0}\n',
            "no playable audio chunk",
        ),
        (
            b'{"type":"metadata","firstAudioMs":22}\n'
            b'{"type":"audio_chunk","sequence":1,"data":"AA=="}\n',
            "without a final event",
        ),
    ],
)
def test_stream_gate_fails_closed_on_incomplete_streams(payload: bytes, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        consume_stream(io.BytesIO(payload), 10.0, FakeClock(10.031, 10.240))
