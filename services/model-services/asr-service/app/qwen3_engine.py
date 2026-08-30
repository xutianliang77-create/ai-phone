import asyncio
import os
from typing import Protocol

from app.audio_buffer import RealtimePcmSegmenter
from app.endpoint_policy import EndpointPolicy
from app.qwen3_context_guard import is_context_echo
from app.qwen3_alignment_runtime import align_final_tokens
from app.qwen3_forced_aligner import TranscriptForcedAligner
from app.qwen3_mixed_language import retry_mixed_language_prefix
from app.qwen3_prompt import (
    clean_correction_pairs,
    clean_prompt_words,
    qwen3_context,
    qwen3_language,
    qwen3_torch_dtype,
)
from app.qwen3_stable_partial import StableReadablePartialCoordinator
from app.schemas import LanguageCode, TranslationLanguageCode
from app.schemas import AsrTranscribeRequest, AsrTranscribeResponse
from app.sensevoice_engine import normalize_transcript, transcript_language, write_temp_wav
from app.vad import VadProvider


class Qwen3Runner(Protocol):
    def transcribe(self, audio_path: str, language: str | None, context: str) -> str:
        ...


class LocalQwen3AsrRunner:
    def __init__(
        self,
        model_dir: str,
        dtype: str,
        device_map: str,
        max_inference_batch_size: int,
        max_new_tokens: int,
    ) -> None:
        import torch
        from qwen_asr import Qwen3ASRModel

        torch_dtype = qwen3_torch_dtype(torch, dtype)
        self._model = Qwen3ASRModel.from_pretrained(
            model_dir,
            dtype=torch_dtype,
            device_map=device_map,
            max_inference_batch_size=max_inference_batch_size,
            max_new_tokens=max_new_tokens,
        )

    def transcribe(self, audio_path: str, language: str | None, context: str) -> str:
        result = self._model.transcribe(
            audio=audio_path,
            context=context,
            language=language,
        )
        if not result:
            return ""
        return str(getattr(result[0], "text", "")).strip()


class Qwen3AsrEngine:
    def __init__(
        self,
        model_dir: str,
        dtype: str,
        device_map: str,
        max_inference_batch_size: int,
        max_new_tokens: int,
        min_audio_ms: int,
        endpoint_silence_ms: int,
        max_audio_ms: int,
        preroll_ms: int,
        vad_energy_threshold: int,
        context: str = "",
        english_context: str = "",
        mixed_language_retry_enabled: bool = False,
        listening_stable_partial_enabled: bool = False,
        runner: Qwen3Runner | None = None,
        vad_provider: VadProvider | None = None,
        endpoint_policies: dict[str, EndpointPolicy] | None = None,
        forced_aligner: TranscriptForcedAligner | None = None,
    ) -> None:
        self.runner = runner or LocalQwen3AsrRunner(
            model_dir=model_dir,
            dtype=dtype,
            device_map=device_map,
            max_inference_batch_size=max_inference_batch_size,
            max_new_tokens=max_new_tokens,
        )
        self.segmenter = RealtimePcmSegmenter(
            min_audio_ms=min_audio_ms,
            endpoint_silence_ms=endpoint_silence_ms,
            max_audio_ms=max_audio_ms,
            preroll_ms=preroll_ms,
            vad_energy_threshold=vad_energy_threshold,
            vad_provider=vad_provider,
            endpoint_policies=endpoint_policies,
        )
        self._recent_text_by_session: dict[str, list[tuple[str, int, int]]] = {}
        self._session_prompt_by_session: dict[str, tuple[list[str], list[tuple[str, str]]]] = {}
        self.context = context
        self.english_context = english_context
        self.mixed_language_retry_enabled = mixed_language_retry_enabled
        self.forced_aligner = forced_aligner
        self.stable_partials = StableReadablePartialCoordinator(
            self.runner,
            listening_stable_partial_enabled,
        )

    def prewarm(self) -> None:
        prewarm = getattr(self.runner, "prewarm", None)
        if prewarm is not None:
            prewarm()

    def shutdown(self) -> None:
        if self.forced_aligner is not None:
            self.forced_aligner.shutdown()
        shutdown = getattr(self.runner, "shutdown", None)
        if shutdown is not None:
            shutdown()

    async def transcribe(
        self,
        request: AsrTranscribeRequest,
    ) -> AsrTranscribeResponse | None:
        self._session_prompt_by_session[request.sessionId] = (
            clean_prompt_words(request.hotwords),
            clean_correction_pairs(request.corrections),
        )
        segment = self.segmenter.append(request)
        if segment is None:
            return await self.stable_partials.observe(
                request,
                self.segmenter.active_audio(request.sessionId),
                qwen3_context(
                    source_language=request.sourceLanguage,
                    context=self.context,
                    english_context=self.english_context,
                    hotwords=request.hotwords,
                    corrections=request.corrections,
                ),
            )
        partial = await self.stable_partials.finish(request.sessionId)
        return await self._transcribe_segment(
            session_id=request.sessionId,
            segment_id=(
                partial.segment_id if partial else f"qwen3_seg_{segment.end_sequence}"
            ),
            revision=partial.revision if partial else None,
            stable_partial_text=partial.text if partial else "",
            pcm=segment.pcm,
            sample_rate=segment.sample_rate,
            source_language=request.sourceLanguage,
            target_language=request.targetLanguage,
            hotwords=request.hotwords,
            corrections=request.corrections,
            start_ms=segment.start_timestamp_ms,
            end_ms=segment.end_timestamp_ms,
            endpoint_reason=segment.endpoint_reason,
        )

    async def flush(
        self,
        session_id: str,
        source_language: LanguageCode,
        target_language: TranslationLanguageCode,
    ) -> AsrTranscribeResponse | None:
        segment = self.segmenter.flush(session_id)
        if segment is None:
            return None
        partial = await self.stable_partials.finish(session_id)
        hotwords, corrections = self._session_prompt_by_session.get(session_id, ([], []))
        return await self._transcribe_segment(
            session_id=session_id,
            segment_id=(
                partial.segment_id if partial else f"qwen3_flush_{segment.end_sequence}"
            ),
            revision=partial.revision if partial else None,
            stable_partial_text=partial.text if partial else "",
            pcm=segment.pcm,
            sample_rate=segment.sample_rate,
            source_language=source_language,
            target_language=target_language,
            hotwords=hotwords,
            corrections=corrections,
            start_ms=segment.start_timestamp_ms,
            end_ms=segment.end_timestamp_ms,
            endpoint_reason=segment.endpoint_reason,
        )

    async def commit_boundary(
        self,
        session_id: str,
        boundary_ms: int,
        source_language: LanguageCode,
        target_language: TranslationLanguageCode,
    ) -> AsrTranscribeResponse | None:
        segment = self.segmenter.commit_boundary(session_id, boundary_ms)
        if segment is None:
            return None
        partial = await self.stable_partials.finish(session_id)
        hotwords, corrections = self._session_prompt_by_session.get(session_id, ([], []))
        return await self._transcribe_segment(
            session_id=session_id,
            segment_id=(
                partial.segment_id
                if partial
                else f"qwen3_boundary_{segment.end_sequence}"
            ),
            revision=partial.revision if partial else None,
            stable_partial_text=partial.text if partial else "",
            pcm=segment.pcm,
            sample_rate=segment.sample_rate,
            source_language=source_language,
            target_language=target_language,
            hotwords=hotwords,
            corrections=corrections,
            start_ms=segment.start_timestamp_ms,
            end_ms=segment.end_timestamp_ms,
            endpoint_reason=segment.endpoint_reason,
        )

    async def close_session(self, session_id: str) -> None:
        self.segmenter.close(session_id)
        self.stable_partials.clear(session_id)
        self._recent_text_by_session.pop(session_id, None)
        self._session_prompt_by_session.pop(session_id, None)

    def diagnostics(self, session_id: str) -> dict[str, object]:
        return {
            **self.segmenter.diagnostics(session_id),
            "stablePartial": self.stable_partials.diagnostics(session_id),
        }

    async def _transcribe_segment(
        self,
        session_id: str,
        segment_id: str,
        revision: int | None,
        stable_partial_text: str,
        pcm: bytes,
        sample_rate: int,
        source_language: LanguageCode,
        target_language: TranslationLanguageCode,
        hotwords: list[str],
        corrections: list[object],
        start_ms: int,
        end_ms: int,
        endpoint_reason: str,
    ) -> AsrTranscribeResponse | None:
        audio_path = write_temp_wav(pcm, sample_rate)
        token_timings = None
        try:
            language = qwen3_language(source_language)
            context = qwen3_context(
                source_language=source_language,
                context=self.context,
                english_context=self.english_context,
                hotwords=hotwords,
                corrections=corrections,
            )
            text = await asyncio.to_thread(
                self.runner.transcribe,
                audio_path,
                language,
                context,
            )
            if self.mixed_language_retry_enabled:
                retry_context = qwen3_context(
                    source_language="en",
                    context=self.context,
                    english_context=self.english_context,
                    hotwords=hotwords,
                    corrections=corrections,
                )
                text = await retry_mixed_language_prefix(
                    transcribe=self.runner.transcribe,
                    audio_path=audio_path,
                    source_language=source_language,
                    primary_text=text,
                    retry_context=retry_context,
                )
            text = text.strip()
            if not text or is_context_echo(text, context):
                text = stable_partial_text.strip()
            if text and not is_context_echo(text, context):
                token_timings = await align_final_tokens(
                    self.forced_aligner,
                    audio_path,
                    text,
                    source_language,
                    target_language,
                    start_ms,
                    end_ms,
                    session_id,
                )
        finally:
            os.unlink(audio_path)

        if not text or is_context_echo(text, context):
            return None
        if self._is_duplicate(session_id, text, start_ms, end_ms):
            return None
        return AsrTranscribeResponse(
            segmentId=segment_id,
            revision=revision,
            isFinal=True,
            text=text,
            language=transcript_language(text, source_language, target_language),
            confidence=None,
            tokenTimings=token_timings,
            timing={
                "startMs": start_ms,
                "endMs": end_ms,
                "source": "client",
            },
            endpointReason=endpoint_reason,
            vadContext=self.segmenter.segment_vad_context(
                session_id,
                endpoint_reason,
            ),
        )

    def _is_duplicate(
        self,
        session_id: str,
        text: str,
        start_ms: int,
        end_ms: int,
    ) -> bool:
        normalized = normalize_transcript(text)
        if not normalized:
            return True
        recent = self._recent_text_by_session.setdefault(session_id, [])
        for previous_text, previous_start, previous_end in recent:
            overlaps = start_ms < previous_end and end_ms > previous_start
            if overlaps and previous_text == normalized:
                return True
        recent.append((normalized, start_ms, end_ms))
        self._recent_text_by_session[session_id] = recent[-8:]
        return False
