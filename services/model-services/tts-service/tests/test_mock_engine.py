import base64

import pytest

from app.mock_engine import MockTtsEngine
from app.schemas import TtsSynthesizeRequest


@pytest.mark.asyncio
async def test_mock_engine_returns_playable_pcm16() -> None:
    engine = MockTtsEngine(sample_rate=16000)

    response = await engine.synthesize(
        TtsSynthesizeRequest(
            text="hello",
            language="en",
            speakerRole="guest",
            segmentId="seg_1",
        )
    )

    payload = base64.b64decode(response.audio.data)
    assert response.provider == "mock"
    assert response.model == "mock-tts-v0.1.0"
    assert response.modelSampleRate == 16000
    assert response.outputSampleRate == 16000
    assert response.audio.sampleRate == 16000
    assert response.audio.format == "pcm16"
    assert len(payload) >= 2
    assert len(payload) % 2 == 0
