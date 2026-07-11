from pathlib import Path

import numpy as np

from app.qwen3_engine import qwen3_torch_dtype


class LocalQwen3HfAsrRunner:
    def __init__(
        self,
        model_dir: str,
        dtype: str,
        device_map: str,
        max_new_tokens: int,
    ) -> None:
        import torch
        from transformers import AutoModelForMultimodalLM, AutoProcessor

        self._torch = torch
        self._processor = AutoProcessor.from_pretrained(
            model_dir,
            local_files_only=True,
        )
        torch_dtype = qwen3_torch_dtype(torch, dtype)
        if device_map == "auto":
            self._model = AutoModelForMultimodalLM.from_pretrained(
                model_dir,
                dtype=torch_dtype,
                device_map="auto",
                local_files_only=True,
            )
        else:
            self._model = AutoModelForMultimodalLM.from_pretrained(
                model_dir,
                dtype=torch_dtype,
                local_files_only=True,
            ).to(device_map)
        self._model.eval()
        self._max_new_tokens = max_new_tokens

    def transcribe(self, audio_path: str, language: str | None, context: str) -> str:
        audio = load_audio_16k(audio_path)
        language_hint = language or "Chinese"
        inputs = self._processor.apply_transcription_request(
            audio=audio,
            language=language_hint,
        ).to(self._model.device, self._model.dtype)
        with self._torch.inference_mode():
            output_ids = self._model.generate(
                **inputs,
                max_new_tokens=self._max_new_tokens,
            )
        generated_ids = output_ids[:, inputs["input_ids"].shape[1] :]
        result = self._processor.decode(
            generated_ids,
            return_format="transcription_only",
        )
        if not result:
            return ""
        return str(result[0]).strip()


def load_audio_16k(audio_path: str) -> np.ndarray:
    import librosa
    import soundfile as sf

    audio, sample_rate = sf.read(Path(audio_path), always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sample_rate != 16000:
        audio = librosa.resample(
            audio.astype(np.float32, copy=False),
            orig_sr=sample_rate,
            target_sr=16000,
        )
    return audio.astype(np.float32, copy=False)
