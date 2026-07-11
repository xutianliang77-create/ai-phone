class PcmStreamBuffer:
    target_sample_rate = 16000

    def __init__(self) -> None:
        self._data = bytearray()
        self._start_sample = 0
        self._source_sample_rate: int | None = None
        self._resampler = None
        self._finalized = False

    @property
    def start_sample(self) -> int:
        return self._start_sample

    @property
    def end_sample(self) -> int:
        return self._start_sample + len(self._data) // 4

    def append(self, pcm: bytes, sample_rate: int) -> None:
        if self._finalized:
            raise ValueError("audio stream is already finalized")
        if self._source_sample_rate not in (None, sample_rate):
            raise ValueError("sample rate changed during speaker session")
        self._source_sample_rate = sample_rate
        samples = pcm16_to_float32(pcm)
        if sample_rate != self.target_sample_rate:
            samples = self._resample(samples, sample_rate, last=False)
        self._append_float32(samples)

    def finalize(self) -> None:
        if self._finalized:
            return
        self._finalized = True
        if self._resampler is None:
            return
        import numpy as np

        tail = self._resampler.resample_chunk(np.empty(0, dtype=np.float32), last=True)
        self._append_float32(tail)

    def samples(self, start_sample: int, end_sample: int):
        if start_sample < self._start_sample or end_sample > self.end_sample:
            raise ValueError("requested audio is outside the rolling buffer")
        import numpy as np

        offset = (start_sample - self._start_sample) * 4
        count = end_sample - start_sample
        return np.frombuffer(self._data, dtype="<f4", count=count, offset=offset).copy()

    def discard_before(self, sample_index: int) -> None:
        target = min(max(sample_index, self._start_sample), self.end_sample)
        byte_count = (target - self._start_sample) * 4
        if byte_count:
            del self._data[:byte_count]
            self._start_sample = target

    def prepare_for_resume(self, sample_index: int) -> None:
        if sample_index < self._start_sample or sample_index > self.end_sample:
            raise ValueError("resume boundary is outside the rolling buffer")
        keep_bytes = (sample_index - self._start_sample) * 4
        del self._data[keep_bytes:]
        self._source_sample_rate = None
        self._resampler = None
        self._finalized = False

    def _resample(self, samples, sample_rate: int, last: bool):
        if self._resampler is None:
            import soxr

            self._resampler = soxr.ResampleStream(
                sample_rate,
                self.target_sample_rate,
                1,
                dtype="float32",
                quality="HQ",
            )
        return self._resampler.resample_chunk(samples, last=last)

    def _append_float32(self, samples) -> None:
        if samples.size:
            self._data.extend(samples.astype("<f4", copy=False).tobytes())


def pcm16_to_float32(pcm: bytes):
    if len(pcm) % 2:
        raise ValueError("pcm16 payload must contain complete samples")
    import numpy as np

    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
