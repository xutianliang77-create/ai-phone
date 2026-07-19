from dataclasses import dataclass

from app.schemas import SpeakerSpan


FRAME_MS = 80


@dataclass
class _ActiveSpeaker:
    start_frame: int
    probability_sum: float = 0.0
    probability_count: int = 0
    overlap: bool = False


class SpeakerActivityDecoder:
    def __init__(
        self,
        max_speakers: int,
        timeline_origin_ms: int,
        onset: float = 0.5,
        offset: float = 0.5,
    ) -> None:
        self._max_speakers = max_speakers
        self._origin_ms = timeline_origin_ms
        self._onset = onset
        self._offset = offset
        self._active: dict[int, _ActiveSpeaker] = {}
        self._next_frame = 0

    def consume(
        self,
        probabilities: list[list[float]],
        start_frame: int,
    ) -> list[SpeakerSpan]:
        if start_frame != self._next_frame:
            raise ValueError("speaker probability frames must be contiguous")
        spans = []
        for offset, frame in enumerate(probabilities):
            frame_index = start_frame + offset
            spans.extend(self._consume_frame(frame, frame_index))
        self._next_frame += len(probabilities)
        return spans

    def flush(self, end_frame: int | None = None) -> list[SpeakerSpan]:
        boundary = self._next_frame if end_frame is None else max(self._next_frame, end_frame)
        spans = [self._span(speaker, boundary, final=True) for speaker in sorted(self._active)]
        self._active.clear()
        self._next_frame = boundary
        return spans

    def active_spans(self) -> list[SpeakerSpan]:
        return [
            self._span(speaker, self._next_frame, final=False)
            for speaker in sorted(self._active)
        ]

    def align_next_frame(self, timestamp_ms: int) -> None:
        if self._active:
            raise ValueError("cannot move speaker timeline while a span is active")
        self._origin_ms = timestamp_ms - self._next_frame * FRAME_MS

    def _consume_frame(self, frame: list[float], frame_index: int) -> list[SpeakerSpan]:
        spans = []
        probabilities = {}
        for speaker in range(self._max_speakers):
            probability = float(frame[speaker]) if speaker < len(frame) else 0.0
            active = self._active.get(speaker)
            if active is None and probability >= self._onset:
                active = _ActiveSpeaker(start_frame=frame_index)
                self._active[speaker] = active
            if active is not None and probability < self._offset:
                spans.append(self._span(speaker, frame_index, final=True))
                del self._active[speaker]
                continue
            if active is not None:
                probabilities[speaker] = probability
        overlap = len(self._active) > 1
        for speaker, probability in probabilities.items():
            active = self._active[speaker]
            if active.probability_count and active.overlap != overlap:
                spans.append(self._span(speaker, frame_index, final=True))
                active = _ActiveSpeaker(start_frame=frame_index, overlap=overlap)
                self._active[speaker] = active
            else:
                active.overlap = overlap
            active.probability_sum += probability
            active.probability_count += 1
        return spans

    def _span(self, speaker: int, end_frame: int, final: bool) -> SpeakerSpan:
        active = self._active[speaker]
        confidence = (
            active.probability_sum / active.probability_count
            if active.probability_count
            else None
        )
        return SpeakerSpan(
            speakerId=f"speaker_{speaker + 1}",
            startMs=self._origin_ms + active.start_frame * FRAME_MS,
            endMs=self._origin_ms + end_frame * FRAME_MS,
            confidence=confidence,
            overlap=active.overlap,
            final=final,
        )
