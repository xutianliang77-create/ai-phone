import pytest

from app.errors import TtsUnavailableError
from app.schemas import TtsSynthesizeRequest
from app.service import TtsService


class FatalCudaEngine:
    calls = 0

    def health(self) -> tuple[bool, str | None]:
        return True, None

    def sample_rates(self) -> tuple[int, int]:
        return 48000, 24000

    async def synthesize(self, _request):
        self.calls += 1
        raise RuntimeError("CUDA error: device-side assert triggered")


@pytest.mark.asyncio
async def test_fatal_cuda_error_latches_unready_and_requests_one_restart() -> None:
    engine = FatalCudaEngine()
    restarts: list[bool] = []
    service = TtsService(engine, fatal_runtime_handler=lambda: restarts.append(True))
    request = TtsSynthesizeRequest(
        text="准备就绪",
        language="zh",
        speakerRole="host",
        segmentId="readiness",
    )

    with pytest.raises(RuntimeError, match="device-side assert"):
        await service.synthesize(request)
    with pytest.raises(TtsUnavailableError, match="process restart required"):
        await service.synthesize(request)

    assert service.health() == (
        False,
        "tts CUDA device-side assert; process restart required",
    )
    assert service.readiness() == service.health()
    assert engine.calls == 1
    assert restarts == [True]
