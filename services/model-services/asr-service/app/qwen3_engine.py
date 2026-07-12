import asyncio
import os
from typing import Protocol

from app.audio_buffer import RealtimePcmSegmenter
from app.endpoint_policy import EndpointPolicy
from app.qwen3_context_guard import is_context_echo
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
        runner: Qwen3Runner | None = None,
        vad_provider: VadProvider | None = None,
        endpoint_policies: dict[str, EndpointPolicy] | None = None,
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
            return None
        return await self._transcribe_segment(
            session_id=request.sessionId,
            segment_id=f"qwen3_seg_{segment.end_sequence}",
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
        hotwords, corrections = self._session_prompt_by_session.get(session_id, ([], []))
        return await self._transcribe_segment(
            session_id=session_id,
            segment_id=f"qwen3_flush_{segment.end_sequence}",
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
        hotwords, corrections = self._session_prompt_by_session.get(session_id, ([], []))
        return await self._transcribe_segment(
            session_id=session_id,
            segment_id=f"qwen3_boundary_{segment.end_sequence}",
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
        self._recent_text_by_session.pop(session_id, None)
        self._session_prompt_by_session.pop(session_id, None)

    async def _transcribe_segment(
        self,
        session_id: str,
        segment_id: str,
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
        finally:
            os.unlink(audio_path)

        text = text.strip()
        if not text or is_context_echo(text, context):
            return None
        if self._is_duplicate(session_id, text, start_ms, end_ms):
            return None
        return AsrTranscribeResponse(
            segmentId=segment_id,
            text=text,
            language=transcript_language(text, source_language, target_language),
            confidence=None,
            timing={
                "startMs": start_ms,
                "endMs": end_ms,
                "source": "client",
            },
            endpointReason=endpoint_reason,
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


def qwen3_language(source_language: LanguageCode) -> str | None:
    if source_language in ("zh", "zh-CN", "Chinese"):
        return "Chinese"
    if source_language in ("en", "en-US", "English"):
        return "English"
    return None


def qwen3_context(
    source_language: LanguageCode,
    context: str,
    english_context: str,
    hotwords: list[str] | None = None,
    corrections: list[object] | None = None,
) -> str:
    prompt = hotword_context(hotwords or [], corrections or [])
    if source_language in ("en", "en-US", "English"):
        return join_context(english_context, prompt)
    return join_context(context, prompt)


def hotword_context(hotwords: list[str], corrections: list[object]) -> str:
    words = clean_prompt_words(hotwords)
    pairs = clean_correction_pairs(corrections)
    parts: list[str] = []
    if words:
        parts.append("优先识别并保留以下热词的准确写法：" + "、".join(words[:120]) + "。")
    if pairs:
        rendered = "；".join(f"{source}=>{target}" for source, target in pairs[:60])
        parts.append("常见误识别纠正：" + rendered + "。")
    return "\n".join(parts)


def join_context(base: str, prompt: str) -> str:
    return "\n".join(part for part in [base.strip(), prompt.strip()] if part)


def clean_prompt_words(words: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for word in words:
        value = str(word).strip()
        if not value or len(value) > 80:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result


def clean_correction_pairs(corrections: list[object]) -> list[tuple[str, str]]:
    result: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in corrections:
        source = getattr(item, "fromText", None)
        target = getattr(item, "toText", None)
        if isinstance(item, dict):
            source = item.get("fromText")
            target = item.get("toText")
        if isinstance(item, tuple) and len(item) == 2:
            source, target = item
        source_text = str(source or "").strip()
        target_text = str(target or "").strip()
        if not source_text or not target_text:
            continue
        key = (source_text.lower(), target_text.lower())
        if key in seen:
            continue
        seen.add(key)
        result.append((source_text, target_text))
    return result


def qwen3_torch_dtype(torch_module, dtype: str):
    normalized = dtype.lower()
    if normalized in ("bf16", "bfloat16"):
        return torch_module.bfloat16
    if normalized in ("fp16", "float16", "half"):
        return torch_module.float16
    if normalized in ("fp32", "float32"):
        return torch_module.float32
    raise ValueError(f"Unsupported Qwen3-ASR dtype: {dtype}")
