import asyncio
import os
import re
import tempfile
from typing import Protocol

from app.audio_buffer import RealtimePcmSegmenter
from app.vad import VadProvider
from app.schemas import LanguageCode, TranslationLanguageCode
from app.schemas import AsrTranscribeRequest, AsrTranscribeResponse
from app.wav_writer import write_pcm16_wav


class SenseVoiceRunner(Protocol):
    def transcribe(self, audio_path: str, language: str) -> str:
        ...


class FunAsrSenseVoiceRunner:
    def __init__(self, model_dir: str, device: str) -> None:
        from funasr import AutoModel
        from funasr.utils.postprocess_utils import rich_transcription_postprocess

        self._postprocess = rich_transcription_postprocess
        self._model = AutoModel(
            model=model_dir,
            trust_remote_code=True,
            device=device,
            disable_update=True,
        )

    def transcribe(self, audio_path: str, language: str) -> str:
        result = self._model.generate(
            input=audio_path,
            language=language,
            use_itn=True,
            batch_size_s=60,
        )
        return self._postprocess(extract_text(result))


class SenseVoiceEngine:
    def __init__(
        self,
        model_dir: str,
        device: str,
        min_audio_ms: int,
        endpoint_silence_ms: int = 600,
        max_audio_ms: int = 8_000,
        preroll_ms: int = 200,
        vad_energy_threshold: int = 350,
        vad_provider: VadProvider | None = None,
        runner: SenseVoiceRunner | None = None,
    ) -> None:
        self.runner = runner or FunAsrSenseVoiceRunner(model_dir, device)
        self.segmenter = RealtimePcmSegmenter(
            min_audio_ms=min_audio_ms,
            endpoint_silence_ms=endpoint_silence_ms,
            max_audio_ms=max_audio_ms,
            preroll_ms=preroll_ms,
            vad_energy_threshold=vad_energy_threshold,
            vad_provider=vad_provider,
        )
        self._last_text_by_session: dict[str, str] = {}

    async def transcribe(
        self,
        request: AsrTranscribeRequest,
    ) -> AsrTranscribeResponse | None:
        segment = self.segmenter.append(request)
        if segment is None:
            return None

        return await self._transcribe_segment(
            session_id=request.sessionId,
            segment_id=f"sensevoice_seg_{segment.end_sequence}",
            pcm=segment.pcm,
            sample_rate=segment.sample_rate,
            source_language=request.sourceLanguage,
            target_language=request.targetLanguage,
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

        return await self._transcribe_segment(
            session_id=session_id,
            segment_id=f"sensevoice_flush_{segment.end_sequence}",
            pcm=segment.pcm,
            sample_rate=segment.sample_rate,
            source_language=source_language,
            target_language=target_language,
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
        return await self._transcribe_segment(
            session_id=session_id,
            segment_id=f"sensevoice_boundary_{segment.end_sequence}",
            pcm=segment.pcm,
            sample_rate=segment.sample_rate,
            source_language=source_language,
            target_language=target_language,
            start_ms=segment.start_timestamp_ms,
            end_ms=segment.end_timestamp_ms,
            endpoint_reason=segment.endpoint_reason,
        )

    async def close_session(self, session_id: str) -> None:
        self.segmenter.close(session_id)
        self._last_text_by_session.pop(session_id, None)

    async def _transcribe_segment(
        self,
        session_id: str,
        segment_id: str,
        pcm: bytes,
        sample_rate: int,
        source_language: LanguageCode,
        target_language: TranslationLanguageCode,
        start_ms: int,
        end_ms: int,
        endpoint_reason: str,
    ) -> AsrTranscribeResponse | None:
        audio_path = write_temp_wav(pcm, sample_rate)
        try:
            language = sensevoice_language(source_language)
            text = await asyncio.to_thread(self.runner.transcribe, audio_path, language)
        finally:
            os.unlink(audio_path)

        text = text.strip()
        if not text:
            return None
        if self._is_duplicate(session_id, text):
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

    def _is_duplicate(self, session_id: str, text: str) -> bool:
        normalized = normalize_transcript(text)
        if not normalized:
            return True
        if self._last_text_by_session.get(session_id) == normalized:
            return True
        self._last_text_by_session[session_id] = normalized
        return False


def write_temp_wav(pcm: bytes, sample_rate: int) -> str:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as wav_file:
        audio_path = wav_file.name
    write_pcm16_wav(audio_path, pcm, sample_rate)
    return audio_path


def sensevoice_language(source_language: LanguageCode) -> str:
    if source_language in ("zh", "en"):
        return source_language
    return "auto"


def transcript_language(
    text: str,
    source_language: LanguageCode,
    target_language: TranslationLanguageCode,
) -> str:
    if source_language in ("zh", "en"):
        return source_language
    inferred = infer_transcript_language(text)
    if inferred is not None:
        return inferred
    return "en" if target_language == "zh" else "zh"


def infer_transcript_language(text: str) -> str | None:
    zh_count = len(re.findall(r"[\u4e00-\u9fff]", text))
    en_word_count = len(re.findall(r"[A-Za-z]+", text))
    if zh_count == 0 and en_word_count == 0:
        return None
    if zh_count > 0 and zh_count * 2 >= en_word_count:
        return "zh"
    return "en"


def extract_text(result: object) -> str:
    if isinstance(result, list) and result:
        first = result[0]
        if isinstance(first, dict):
            return str(first.get("text", ""))
    if isinstance(result, dict):
        return str(result.get("text", ""))
    return str(result)


def normalize_transcript(text: str) -> str:
    without_markers = re.sub(
        r"(?:<|\[|\()(?:\|?\s*)?(?:sil|noise|blank|unk|nospeech|no[\s_-]*speech|inaudible)(?:\s*\|?)?(?:>|\]|\))",
        "",
        text,
        flags=re.IGNORECASE,
    )
    return re.sub(r"[\W_]+", "", without_markers.lower())
