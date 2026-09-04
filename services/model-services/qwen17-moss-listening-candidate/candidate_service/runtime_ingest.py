from __future__ import annotations

import numpy as np

from candidate_service.audio import confirmed_readable_prefix, language_code
from candidate_service.state import SessionState, Utterance


class CandidateIngestMixin:
    def _ingest(
        self,
        session: SessionState,
        audio: np.ndarray,
        duration_ms: float,
        speech: bool,
        speech_probability: float | None,
        timestamp_ms: int,
    ) -> None:
        if speech:
            self._metrics["speechFrames"] = (
                int(self._metrics["speechFrames"] or 0) + 1
            )
            session.speech_frames += 1
        if session.utterance is None:
            self._append_prerolls(session, audio)
            if not speech:
                return
            with self._gpu_lock:
                qwen_state = self.qwen.new_state(session.source_language)
            utterance = Utterance(
                segment_id=f"qwen17_{session.next_segment}",
                qwen_state=qwen_state,
                start_ms=max(
                    0,
                    timestamp_ms - round(session.preroll_samples / 16),
                ),
                voiced_ms=duration_ms,
                max_speech_probability=speech_probability,
            )
            session.next_segment += 1
            session.utterance = utterance
            buffered = (
                np.concatenate(list(session.preroll))
                if session.preroll
                else audio
            )
            revision_buffered = (
                np.concatenate(list(session.revision_preroll))
                if session.revision_preroll
                else buffered
            )
            utterance.audio.append(revision_buffered)
            utterance.final_audio.append(buffered)
            session.preroll.clear()
            session.preroll_samples = 0
            session.revision_preroll.clear()
            session.revision_preroll_samples = 0
            self._feed_qwen(session, utterance, buffered, record_audio=False)
            return

        utterance = session.utterance
        if speech:
            utterance.voiced_ms += duration_ms
            if speech_probability is not None:
                utterance.max_speech_probability = max(
                    utterance.max_speech_probability or 0,
                    speech_probability,
                )
        self._feed_qwen(session, utterance, audio)
        utterance.silence_ms = (
            utterance.silence_ms + duration_ms if not speech else 0
        )
        total_ms = utterance.samples / 16
        if total_ms >= self.config.max_audio_ms:
            self._finalize(session, "max_duration")
        elif utterance.silence_ms >= self.config.endpoint_silence_ms:
            self._finalize(session, "silence")

    def _append_prerolls(self, session: SessionState, audio: np.ndarray) -> None:
        session.preroll.append(audio)
        session.preroll_samples += len(audio)
        max_samples = self.config.preroll_ms * 16
        while session.preroll and session.preroll_samples > max_samples:
            session.preroll_samples -= len(session.preroll.popleft())
        session.revision_preroll.append(audio)
        session.revision_preroll_samples += len(audio)
        revision_max_samples = self.config.revision_preroll_ms * 16
        while (
            session.revision_preroll
            and session.revision_preroll_samples > revision_max_samples
        ):
            session.revision_preroll_samples -= len(
                session.revision_preroll.popleft()
            )

    def _feed_qwen(
        self,
        session: SessionState,
        utterance: Utterance,
        audio: np.ndarray,
        record_audio: bool = True,
    ) -> None:
        if record_audio:
            utterance.audio.append(audio)
            utterance.final_audio.append(audio)
        utterance.samples += len(audio)
        with self._gpu_lock:
            decode_id, text, _language = self.qwen.push(
                utterance.qwen_state,
                audio,
            )
        if decode_id <= 0 or not text or text == utterance.previous_decode:
            return
        confirmed = confirmed_readable_prefix(
            utterance.previous_decode,
            text,
            self.config.minimum_readable_units,
        )
        utterance.previous_decode = text
        if not confirmed or confirmed == utterance.last_partial:
            return
        if utterance.last_partial and not confirmed.startswith(
            utterance.last_partial
        ):
            return
        utterance.last_partial = confirmed
        session.responses.append(
            self._response(
                utterance,
                confirmed,
                self._state_language(utterance, session),
                None,
            )
        )
        self._metrics["partials"] = int(self._metrics["partials"] or 0) + 1
        session.partials += 1

    def _start_retained_utterance(
        self,
        session: SessionState,
        audio: np.ndarray,
        start_ms: int,
        speech_probability: float | None,
    ) -> None:
        with self._gpu_lock:
            qwen_state = self.qwen.new_state(session.source_language)
        utterance = Utterance(
            segment_id=f"qwen17_{session.next_segment}",
            qwen_state=qwen_state,
            start_ms=start_ms,
            audio=[audio],
            final_audio=[audio],
            voiced_ms=len(audio) / 16,
            max_speech_probability=speech_probability,
        )
        session.next_segment += 1
        session.utterance = utterance
        self._feed_qwen(session, utterance, audio, record_audio=False)

    def _state_language(
        self,
        utterance: Utterance,
        session: SessionState,
    ) -> str:
        model_language = str(
            getattr(utterance.qwen_state, "language", "") or ""
        )
        return language_code(model_language, session.source_language)
