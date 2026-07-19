from dataclasses import dataclass
from threading import Lock

from app.pcm_stream_buffer import PcmStreamBuffer
from app.schemas import SpeakerSpan
from app.speaker_activity_decoder import SpeakerActivityDecoder


DIAR_FRAME_MS = 80
SAMPLES_PER_DIAR_FRAME = PcmStreamBuffer.target_sample_rate * DIAR_FRAME_MS // 1000


@dataclass
class StreamingProfile:
    chunk_len: int = 6
    chunk_left_context: int = 1
    chunk_right_context: int = 7
    fifo_len: int = 188
    spkcache_update_period: int = 144
    spkcache_len: int = 188


@dataclass
class StreamingRuntimeState:
    model_state: object
    next_diar_frame: int = 0


class SortformerStreamingRuntime:
    def __init__(self, model, profile: StreamingProfile) -> None:
        self._model = model
        self._profile = profile
        self._lock = Lock()
        modules = model.sortformer_modules
        modules.chunk_len = profile.chunk_len
        modules.chunk_left_context = profile.chunk_left_context
        modules.chunk_right_context = profile.chunk_right_context
        modules.fifo_len = profile.fifo_len
        modules.spkcache_update_period = profile.spkcache_update_period
        modules.spkcache_len = profile.spkcache_len
        modules._check_streaming_parameters()

    def create_state(self) -> StreamingRuntimeState:
        with self._lock:
            state = self._model.sortformer_modules.init_streaming_state(
                batch_size=1,
                async_streaming=self._model.async_streaming,
                device=self._model.device,
            )
        return StreamingRuntimeState(model_state=state)

    def ready(self, state: StreamingRuntimeState, audio: PcmStreamBuffer) -> bool:
        available = audio.end_sample // SAMPLES_PER_DIAR_FRAME
        required = (
            state.next_diar_frame
            + self._profile.chunk_len
            + self._profile.chunk_right_context
        )
        return available >= required

    def process_available(
        self,
        state: StreamingRuntimeState,
        audio: PcmStreamBuffer,
        decoder: SpeakerActivityDecoder,
        flush: bool,
    ) -> list[SpeakerSpan]:
        spans = []
        with self._lock:
            while self._can_process(state, audio, flush):
                probabilities = self._process_step(state, audio, flush)
                start_frame = state.next_diar_frame
                state.next_diar_frame += len(probabilities)
                spans.extend(decoder.consume(probabilities, start_frame))
                keep_from = max(
                    0,
                    state.next_diar_frame - self._profile.chunk_left_context,
                )
                audio.discard_before(keep_from * SAMPLES_PER_DIAR_FRAME)
        if flush:
            spans.extend(decoder.flush())
        else:
            spans.extend(decoder.active_spans())
        return spans

    def _can_process(
        self,
        state: StreamingRuntimeState,
        audio: PcmStreamBuffer,
        flush: bool,
    ) -> bool:
        available = audio.end_sample // SAMPLES_PER_DIAR_FRAME
        if state.next_diar_frame >= available:
            return False
        return flush or self.ready(state, audio)

    def _process_step(
        self,
        state: StreamingRuntimeState,
        audio: PcmStreamBuffer,
        flush: bool,
    ) -> list[list[float]]:
        import torch

        available = audio.end_sample // SAMPLES_PER_DIAR_FRAME
        start = state.next_diar_frame
        end = min(start + self._profile.chunk_len, available)
        right = min(self._profile.chunk_right_context, available - end)
        if not flush and right < self._profile.chunk_right_context:
            return []
        left = min(self._profile.chunk_left_context, start)
        samples = audio.samples(
            (start - left) * SAMPLES_PER_DIAR_FRAME,
            (end + right) * SAMPLES_PER_DIAR_FRAME,
        )
        waveform = torch.from_numpy(samples).unsqueeze(0).to(self._model.device)
        waveform_length = torch.tensor([len(samples)], device=self._model.device)
        with torch.inference_mode():
            features, feature_lengths = self._model.preprocessor(
                input_signal=waveform,
                length=waveform_length,
            )
            features = features[:, :, : feature_lengths.max()].transpose(1, 2)
            empty = torch.zeros(
                (1, 0, self._model.sortformer_modules.n_spk),
                device=self._model.device,
            )
            state.model_state, predictions = self._model.forward_streaming_step(
                processed_signal=features,
                processed_signal_length=feature_lengths,
                streaming_state=state.model_state,
                total_preds=empty,
                left_offset=left * self._model.encoder.subsampling_factor,
                right_offset=right * self._model.encoder.subsampling_factor,
            )
        expected = end - start
        values = predictions[0, :expected].detach().cpu().tolist()
        if len(values) != expected:
            raise RuntimeError("Sortformer returned an unexpected frame count")
        return values
