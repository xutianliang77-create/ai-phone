from dataclasses import dataclass
import math

from app.schemas import SpeakerSpan


FRAME_MS = 80


@dataclass
class _ActiveSpeaker:
    start_frame: int
    probability_sum: float = 0.0
    probability_count: int = 0
    confirmed: bool = False
    overlap: bool = False
    pending_off_frame: int | None = None


class SpeakerActivityDecoder:
    def __init__(
        self,
        max_speakers: int,
        timeline_origin_ms: int,
        onset: float = 0.5,
        offset: float = 0.5,
        pad_offset_ms: int = 0,
        min_duration_on_ms: int = 0,
        min_duration_off_ms: int = 0,
    ) -> None:
        self._max_speakers = max_speakers
        self._origin_ms = timeline_origin_ms
        self._onset = onset
        self._offset = offset
        self._pad_offset_ms = max(0, pad_offset_ms)
        self._min_on_frames = max(
            1,
            math.ceil(min_duration_on_ms / FRAME_MS),
        )
        self._min_off_frames = max(
            0,
            math.ceil(min_duration_off_ms / FRAME_MS),
        )
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
        spans = [
            self._span(
                speaker,
                (
                    self._active[speaker].pending_off_frame
                    if self._active[speaker].pending_off_frame is not None
                    else boundary
                ),
                final=True,
                end_padding_ms=(
                    self._pad_offset_ms
                    if self._active[speaker].pending_off_frame is not None
                    else 0
                ),
            )
            for speaker in sorted(self._active)
            if self._active[speaker].confirmed
        ]
        self._active.clear()
        self._next_frame = boundary
        return spans

    def active_spans(self) -> list[SpeakerSpan]:
        return [
            self._span(
                speaker,
                (
                    self._active[speaker].pending_off_frame
                    if self._active[speaker].pending_off_frame is not None
                    else self._next_frame
                ),
                final=False,
                end_padding_ms=(
                    self._pad_offset_ms
                    if self._active[speaker].pending_off_frame is not None
                    else 0
                ),
            )
            for speaker in sorted(self._active)
            if self._active[speaker].confirmed
        ]

    def align_next_frame(self, timestamp_ms: int) -> None:
        if self._active:
            raise ValueError("cannot move speaker timeline while a span is active")
        self._origin_ms = timestamp_ms - self._next_frame * FRAME_MS

    def _consume_frame(self, frame: list[float], frame_index: int) -> list[SpeakerSpan]:
        spans = []
        probabilities = {}
        newly_confirmed = set()
        for speaker in range(self._max_speakers):
            probability = float(frame[speaker]) if speaker < len(frame) else 0.0
            active = self._active.get(speaker)
            if active is None and probability >= self._onset:
                active = _ActiveSpeaker(start_frame=frame_index)
                self._active[speaker] = active
            elif active is not None:
                if not active.confirmed and probability < self._offset:
                    del self._active[speaker]
                    active = None
                elif active.pending_off_frame is not None:
                    pending_off_frame = active.pending_off_frame
                    if (
                        frame_index - pending_off_frame >= self._min_off_frames
                    ):
                        spans.append(self._span(
                            speaker,
                            pending_off_frame,
                            final=True,
                            end_padding_ms=self._pad_offset_ms,
                        ))
                        del self._active[speaker]
                        active = None
                        if probability >= self._onset:
                            active = _ActiveSpeaker(start_frame=frame_index)
                            self._active[speaker] = active
                    elif probability >= self._offset:
                        active.pending_off_frame = None
                elif probability < self._offset:
                    if self._min_off_frames == 0:
                        spans.append(self._span(
                            speaker,
                            frame_index,
                            final=True,
                            end_padding_ms=self._pad_offset_ms,
                        ))
                        del self._active[speaker]
                        active = None
                    else:
                        active.pending_off_frame = frame_index
            if active is not None and active.pending_off_frame is None:
                if not active.confirmed:
                    active.probability_sum += probability
                    active.probability_count += 1
                    if active.probability_count >= self._min_on_frames:
                        active.confirmed = True
                        newly_confirmed.add(speaker)
                if active.confirmed:
                    probabilities[speaker] = probability
        overlap = len(probabilities) > 1
        for speaker, probability in probabilities.items():
            active = self._active[speaker]
            if speaker in newly_confirmed:
                active.overlap = overlap
            elif active.overlap != overlap:
                spans.append(self._span(speaker, frame_index, final=True))
                active = _ActiveSpeaker(
                    start_frame=frame_index,
                    confirmed=True,
                    overlap=overlap,
                )
                self._active[speaker] = active
                active.probability_sum += probability
                active.probability_count += 1
            else:
                active.probability_sum += probability
                active.probability_count += 1
        return spans

    def _span(
        self,
        speaker: int,
        end_frame: int,
        final: bool,
        end_padding_ms: int = 0,
    ) -> SpeakerSpan:
        active = self._active[speaker]
        confidence = (
            active.probability_sum / active.probability_count
            if active.probability_count
            else None
        )
        return SpeakerSpan(
            speakerId=f"speaker_{speaker + 1}",
            startMs=self._origin_ms + active.start_frame * FRAME_MS,
            endMs=self._origin_ms + end_frame * FRAME_MS + end_padding_ms,
            confidence=confidence,
            overlap=active.overlap,
            final=final,
        )
