import asyncio
import base64
import logging
import math
import os
import re
import struct
import tempfile
from typing import Protocol

from app.audio_buffer import RealtimePcmSegmenter
from app.pcm_audio import audio_duration_ms
from app.vad import VadProvider
from app.schemas import LanguageCode, TranslationLanguageCode
from app.schemas import AsrTranscribeRequest, AsrTranscribeResponse
from app.wav_writer import write_pcm16_wav


logger = logging.getLogger(__name__)


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

    async def transcribe_segment(
        self,
        request: AsrTranscribeRequest,
    ) -> AsrTranscribeResponse | None:
        """Transcribe one ESP32-bounded segment without invoking service VAD."""

        pcm = base64.b64decode(request.data, validate=True)
        duration_ms = audio_duration_ms(pcm, request.sampleRate)
        if duration_ms <= 0:
            return None
        return await self._transcribe_segment(
            session_id=request.sessionId,
            segment_id=f"sensevoice_device_vad_{request.sequence}",
            pcm=pcm,
            sample_rate=request.sampleRate,
            source_language=request.sourceLanguage,
            target_language=request.targetLanguage,
            start_ms=request.timestampMs,
            end_ms=request.timestampMs + duration_ms,
            endpoint_reason="device_vad",
            vad_context={
                "provider": "external",
                "source": "esp32-afe-v1",
            },
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
        vad_context: dict[str, object] | None = None,
    ) -> AsrTranscribeResponse | None:
        if endpoint_reason == "device_vad":
            metrics = pcm16_signal_metrics(pcm, sample_rate)
            logger.info(
                "external_segment_received bytes=%s duration_ms=%s rms=%s peak=%s zero_percent=%s",
                len(pcm),
                metrics["duration_ms"],
                metrics["rms"],
                metrics["peak"],
                metrics["zero_percent"],
            )
        audio_path = write_temp_wav(pcm, sample_rate)
        try:
            language = sensevoice_language(source_language)
            text = await asyncio.to_thread(self.runner.transcribe, audio_path, language)
        finally:
            os.unlink(audio_path)

        text = text.strip()
        normalized = normalize_transcript(text)
        if not normalized:
            if endpoint_reason == "device_vad":
                logger.info(
                    "external_segment_result result=empty_or_nonspeech raw_chars=%s",
                    len(text),
                )
            return None
        if self._last_text_by_session.get(session_id) == normalized:
            if endpoint_reason == "device_vad":
                logger.info(
                    "external_segment_result result=duplicate normalized_chars=%s",
                    len(normalized),
                )
            return None
        self._last_text_by_session[session_id] = normalized
        if endpoint_reason == "device_vad":
            logger.info(
                "external_segment_result result=accepted text_chars=%s",
                len(text),
            )

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
            vadContext=(
                vad_context
                if vad_context is not None
                else self.segmenter.segment_vad_context(
                    session_id,
                    endpoint_reason,
                )
            ),
        )

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


def pcm16_signal_metrics(pcm: bytes, sample_rate: int) -> dict[str, int | float]:
    even_length = len(pcm) - (len(pcm) % 2)
    if even_length <= 0 or sample_rate <= 0:
        return {"duration_ms": 0, "rms": 0, "peak": 0, "zero_percent": 100.0}
    total_square = 0
    peak = 0
    zero_count = 0
    sample_count = 0
    for (sample,) in struct.iter_unpack("<h", pcm[:even_length]):
        absolute = abs(sample)
        peak = max(peak, absolute)
        total_square += sample * sample
        zero_count += int(sample == 0)
        sample_count += 1
    return {
        "duration_ms": even_length * 1000 // (sample_rate * 2),
        "rms": int(math.sqrt(total_square / sample_count)) if sample_count else 0,
        "peak": peak,
        "zero_percent": round(zero_count * 100 / sample_count, 1) if sample_count else 100.0,
    }
