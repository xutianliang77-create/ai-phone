import math
from threading import Event, Lock


class FakeTtsModel:
    def __init__(self, sample_rate: int) -> None:
        self.sample_rate = sample_rate


class FakeVoxCpmModel:
    def __init__(self, sample_rate: int = 24000, duration_seconds: int = 0) -> None:
        self.tts_model = FakeTtsModel(sample_rate)
        self.duration_seconds = duration_seconds
        self.kwargs = {}

    def generate(self, **kwargs):
        self.kwargs = kwargs
        if self.duration_seconds:
            return [
                0.5 * math.sin(2 * math.pi * 440 * index / self.tts_model.sample_rate)
                for index in range(self.tts_model.sample_rate * self.duration_seconds)
            ]
        return [0.0, 0.1, -0.1]


class FakeStreamingCapableVoxCpmModel(FakeVoxCpmModel):
    def __init__(self) -> None:
        super().__init__()
        self.generate_calls = 0
        self.streaming_calls = 0

    def generate(self, **kwargs):
        self.generate_calls += 1
        return super().generate(**kwargs)

    def generate_streaming(self, **kwargs):
        self.streaming_calls += 1
        yield super().generate(**kwargs)


class BlockingStreamingVoxCpmModel(FakeVoxCpmModel):
    def __init__(self) -> None:
        super().__init__()
        self.started = Event()
        self.release = Event()
        self.streaming_calls = 0
        self.peak_active = 0
        self._active = 0
        self._lock = Lock()

    def generate_streaming(self, **kwargs):
        self.streaming_calls += 1

        def iterator():
            with self._lock:
                self._active += 1
                self.peak_active = max(self.peak_active, self._active)
            self.started.set()
            self.release.wait(timeout=2)
            try:
                yield super(BlockingStreamingVoxCpmModel, self).generate(**kwargs)
            finally:
                with self._lock:
                    self._active -= 1

        return iterator()
