import asyncio
import os
from pathlib import Path
from typing import Protocol

from app.audio_buffer import RealtimePcmSegmenter
from app.vad import VadProvider
from app.schemas import LanguageCode, TranslationLanguageCode
from app.schemas import AsrTranscribeRequest, AsrTranscribeResponse
from app.sensevoice_engine import normalize_transcript, transcript_language, write_temp_wav


class FireRedRunner(Protocol):
    def transcribe(self, audio_path: str) -> str:
        ...


class LocalFireRedAedRunner:
    def __init__(self, model_dir: str, use_gpu: bool, beam_size: int) -> None:
        import torch
        from fireredasr.data.asr_feat import ASRFeatExtractor
        from fireredasr.models.fireredasr_aed import FireRedAsrAed
        from fireredasr.tokenizer.aed_tokenizer import ChineseCharEnglishSpmTokenizer

        root = Path(model_dir)
        package = torch.load(
            root / "model.pth.tar",
            map_location=lambda storage, loc: storage,
            weights_only=False,
        )
        model = FireRedAsrAed.from_args(package["args"])
        model.load_state_dict(package["model_state_dict"], strict=False)
        model.eval()
        self._torch = torch
        self._model = model
        self._feat_extractor = ASRFeatExtractor(str(root / "cmvn.ark"))
        self._tokenizer = ChineseCharEnglishSpmTokenizer(
            str(root / "dict.txt"),
            str(root / "train_bpe1000.model"),
        )
        self._use_gpu = use_gpu and torch.cuda.is_available()
        self._beam_size = beam_size

    def transcribe(self, audio_path: str) -> str:
        feats, lengths, _ = self._feat_extractor([audio_path])
        if self._use_gpu:
            feats, lengths = feats.cuda(), lengths.cuda()
            self._model.cuda()
        else:
            self._model.cpu()

        with self._torch.no_grad():
            hyps = self._model.transcribe(feats, lengths, self._beam_size)
        hyp_ids = [int(item) for item in hyps[0][0]["yseq"].cpu()]
        return self._tokenizer.detokenize(hyp_ids)


class FireRedAsr2AedEngine:
    def __init__(
        self,
        model_dir: str,
        use_gpu: bool,
        beam_size: int,
        min_audio_ms: int,
        endpoint_silence_ms: int,
        max_audio_ms: int,
        preroll_ms: int,
        vad_energy_threshold: int,
        vad_provider: VadProvider | None = None,
        runner: FireRedRunner | None = None,
    ) -> None:
        self.runner = runner or LocalFireRedAedRunner(model_dir, use_gpu, beam_size)
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
            segment_id=f"firered_seg_{segment.end_sequence}",
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
            segment_id=f"firered_flush_{segment.end_sequence}",
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
            segment_id=f"firered_boundary_{segment.end_sequence}",
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
            text = await asyncio.to_thread(self.runner.transcribe, audio_path)
        finally:
            os.unlink(audio_path)

        text = text.strip()
        if not text or self._is_duplicate(session_id, text):
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
            vadContext=self.segmenter.segment_vad_context(
                session_id,
                endpoint_reason,
            ),
        )

    def _is_duplicate(self, session_id: str, text: str) -> bool:
        normalized = normalize_transcript(text)
        if not normalized:
            return True
        if self._last_text_by_session.get(session_id) == normalized:
            return True
        self._last_text_by_session[session_id] = normalized
        return False
