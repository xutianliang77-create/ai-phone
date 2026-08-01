from __future__ import annotations

import copy
import base64
import json
import sys
import urllib.request
from typing import Protocol

import numpy as np

from candidate_service.audio import remove_temp_wav, write_temp_wav


class QwenRunner(Protocol):
    def new_state(self, source_language: str):
        ...

    def push(self, state, audio: np.ndarray) -> tuple[int, str, str]:
        ...

    def finish(self, state) -> tuple[str, str]:
        ...

    def transcribe_final(
        self,
        audio: np.ndarray,
        source_language: str,
        detected_language: str,
    ) -> tuple[str, str]:
        ...


class MossRunner(Protocol):
    def transcribe(self, audio: np.ndarray) -> tuple[str, int]:
        ...


class HttpMossRunner:
    def __init__(self, endpoint: str, api_key: str, timeout_seconds: int) -> None:
        self._endpoint = endpoint
        self._api_key = api_key
        self._timeout_seconds = timeout_seconds

    def transcribe(self, audio: np.ndarray) -> tuple[str, int]:
        pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
        request = urllib.request.Request(
            self._endpoint,
            data=json.dumps(
                {"audioPcm16": base64.b64encode(pcm).decode("ascii")}
            ).encode("utf-8"),
            headers={
                "authorization": f"Bearer {self._api_key}",
                "content-type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(
            request,
            timeout=self._timeout_seconds,
        ) as response:
            payload = json.load(response)
        return str(payload["text"]), int(payload["speakerCount"])


class LocalQwen17Runner:
    def __init__(
        self,
        model_path: str,
        gpu_memory_utilization: float,
        max_model_len: int,
        max_new_tokens: int,
        final_max_new_tokens: int,
        unfixed_chunk_num: int,
        unfixed_token_num: int,
        decode_schedule_ms: tuple[int, ...],
        steady_decode_ms: int,
    ) -> None:
        from qwen_asr import Qwen3ASRModel

        self._asr = Qwen3ASRModel.LLM(
            model=model_path,
            gpu_memory_utilization=gpu_memory_utilization,
            max_new_tokens=max_new_tokens,
            max_model_len=max_model_len,
            max_num_seqs=1,
            enforce_eager=True,
        )
        self._unfixed_chunk_num = unfixed_chunk_num
        self._unfixed_token_num = unfixed_token_num
        self._final_max_new_tokens = final_max_new_tokens
        self._schedule_samples = [
            round(16000 * value / 1000) for value in decode_schedule_ms
        ]
        self._steady_samples = round(16000 * steady_decode_ms / 1000)

    def prewarm(self) -> None:
        for language in ("Chinese", None):
            state = self._asr.init_streaming_state(
                language=language,
                unfixed_chunk_num=self._unfixed_chunk_num,
                unfixed_token_num=self._unfixed_token_num,
                chunk_size_sec=1,
            )
            self._asr.streaming_transcribe(
                np.zeros(16000, dtype=np.float32),
                state,
            )

    def new_state(self, source_language: str):
        language = forced_language(source_language)
        return self._asr.init_streaming_state(
            language=language,
            unfixed_chunk_num=self._unfixed_chunk_num,
            unfixed_token_num=self._unfixed_token_num,
            chunk_size_sec=self._schedule_samples[0] / 16000,
        )

    def push(self, state, audio: np.ndarray) -> tuple[int, str, str]:
        previous_decode_id = int(state.chunk_id)
        self._asr.streaming_transcribe(audio, state)
        if state.chunk_id != previous_decode_id:
            state.chunk_size_samples = self._next_decode_samples(state.chunk_id)
            state.chunk_size_sec = state.chunk_size_samples / 16000
        return int(state.chunk_id), str(state.text or "").strip(), str(
            state.language or ""
        )

    def finish(self, state) -> tuple[str, str]:
        self._asr.finish_streaming_transcribe(state)
        return str(state.text or "").strip(), str(state.language or "")

    def transcribe_final(
        self,
        audio: np.ndarray,
        source_language: str,
        detected_language: str,
    ) -> tuple[str, str]:
        language = forced_language(source_language)
        if language is None and detected_language and "," not in detected_language:
            language = detected_language
        sampling_params = self._asr.sampling_params
        previous_max_tokens = sampling_params.max_tokens
        sampling_params.max_tokens = self._final_max_new_tokens
        try:
            result = self._asr.transcribe(
                audio=(audio, 16000),
                language=language,
            )[0]
        finally:
            sampling_params.max_tokens = previous_max_tokens
        return str(result.text or "").strip(), str(result.language or "")

    def _next_decode_samples(self, completed_decode_count: int) -> int:
        if completed_decode_count < len(self._schedule_samples):
            previous_total = self._schedule_samples[completed_decode_count - 1]
            next_total = self._schedule_samples[completed_decode_count]
            return max(1, next_total - previous_total)
        return self._steady_samples


LANGUAGE_NAMES = {
    "ar": "Arabic",
    "de": "German",
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "hi": "Hindi",
    "ja": "Japanese",
    "ko": "Korean",
    "pt": "Portuguese",
    "ru": "Russian",
    "vi": "Vietnamese",
    "zh": "Chinese",
}


def forced_language(source_language: str) -> str | None:
    normalized = source_language.strip().lower()
    if not normalized or normalized == "auto":
        return None
    return LANGUAGE_NAMES.get(normalized.split("-", 1)[0])


class LocalMossRunner:
    def __init__(self, model_path: str, source_root: str) -> None:
        import torch
        from transformers import AutoModelForCausalLM, AutoProcessor

        sys.path.insert(0, source_root)
        from moss_transcribe_diarize import (
            inference_utils,
            subtitle_segments_from_transcript,
        )

        self._torch = torch
        self._inference_utils = inference_utils
        self._subtitle_segments = subtitle_segments_from_transcript
        self._model = AutoModelForCausalLM.from_pretrained(
            model_path,
            trust_remote_code=True,
            dtype="auto",
        ).to(dtype=torch.bfloat16).to(torch.device("cuda:0")).eval()
        self._processor = AutoProcessor.from_pretrained(
            model_path,
            trust_remote_code=True,
            fix_mistral_regex=True,
        )

    def prewarm(self) -> None:
        self.transcribe(np.zeros(16000, dtype=np.float32))

    def transcribe(self, audio: np.ndarray) -> tuple[str, int]:
        path = write_temp_wav(audio)
        try:
            messages = self._inference_utils.build_transcription_messages(path)
            inputs = self._inference_utils.prepare_inputs(
                self._processor,
                messages,
                max_length=131072,
                device=next(self._model.parameters()).device,
            ).to(next(self._model.parameters()).device)
            prompt_len = int(inputs["attention_mask"][0].sum().item())
            generation_config = copy.deepcopy(self._model.generation_config)
            generation_config.max_new_tokens = 2048
            generation_config.do_sample = False
            with self._torch.inference_mode(), self._torch.amp.autocast(
                "cuda",
                dtype=self._torch.bfloat16,
            ):
                outputs = self._model.generate(
                    input_ids=inputs["input_ids"],
                    attention_mask=inputs["attention_mask"],
                    input_features=inputs["input_features"],
                    audio_feature_lengths=inputs["audio_feature_lengths"],
                    audio_chunk_mapping=inputs["audio_chunk_mapping"],
                    generation_config=generation_config,
                )
            generated_ids = outputs[0, prompt_len:]
            raw = self._processor.tokenizer.decode(
                generated_ids,
                skip_special_tokens=True,
            ).strip()
            segments = self._subtitle_segments(raw, postprocess=False)
            text = " ".join(
                str(segment.text).strip()
                for segment in segments
                if str(segment.text).strip()
            )
            speakers = {
                str(segment.speaker).strip()
                for segment in segments
                if str(segment.speaker).strip()
            }
            return text, len(speakers)
        finally:
            remove_temp_wav(path)
