from collections.abc import Mapping
from pathlib import Path
from threading import Thread

from app.config import TranslationConfig
from app.engines import TranslationEngine, TranslationInput


class HyMt2Engine(TranslationEngine):
    provider = "hymt2_self_hosted"

    def __init__(self, config: TranslationConfig):
        self.config = config
        self._load_error: str | None = None
        self.tokenizer = None
        self.model = None
        try:
            self._load()
        except Exception as exc:  # pragma: no cover - depends on optional runtime.
            self._load_error = str(exc)

    def health(self) -> tuple[bool, str | None]:
        if self._load_error:
            return False, self._load_error
        return True, None

    def translate(self, request: TranslationInput) -> str:
        return self.translate_batch([request])[0]

    def translate_batch(self, requests: list[TranslationInput]) -> list[str]:
        if self._load_error or self.tokenizer is None or self.model is None:
            raise RuntimeError(self._load_error or "Hy-MT2 model is not loaded")
        if not requests:
            return []
        import torch

        prompts = [self.tokenizer.apply_chat_template(
            [{"role": "user", "content": build_prompt(
                request.text,
                request.target_language,
                previous_segments=request.previous_segments,
                glossary=request.glossary,
                protected_entities=request.protected_entities,
            )}],
            add_generation_prompt=True,
            tokenize=False,
        ) for request in requests]
        inputs = self.tokenizer(
            prompts,
            padding=True,
            return_tensors="pt",
        ).to(self.model.device)
        model_inputs = as_model_inputs(inputs)
        with torch.no_grad():
            outputs = self.model.generate(
                **model_inputs,
                max_new_tokens=min(requests[0].max_tokens, self.config.max_new_tokens),
                temperature=self.config.temperature,
                top_p=self.config.top_p,
                top_k=self.config.top_k,
                repetition_penalty=self.config.repetition_penalty,
            )
        prompt_tokens = model_inputs["input_ids"].shape[-1]
        return [
            self.tokenizer.decode(output[prompt_tokens:], skip_special_tokens=True).strip()
            for output in outputs
        ]

    def translate_stream(self, request: TranslationInput):
        if self._load_error or self.tokenizer is None or self.model is None:
            raise RuntimeError(self._load_error or "Hy-MT2 model is not loaded")
        import torch
        from transformers import TextIteratorStreamer

        prompt = build_prompt(
            request.text,
            request.target_language,
            previous_segments=request.previous_segments,
            glossary=request.glossary,
            protected_entities=request.protected_entities,
        )
        inputs = self.tokenizer.apply_chat_template(
            [{"role": "user", "content": prompt}],
            add_generation_prompt=True,
            return_tensors="pt",
        ).to(self.model.device)
        model_inputs = as_model_inputs(inputs)
        streamer = TextIteratorStreamer(
            self.tokenizer,
            skip_prompt=True,
            skip_special_tokens=True,
        )
        errors: list[Exception] = []

        def generate() -> None:
            try:
                with torch.no_grad():
                    self.model.generate(
                        **model_inputs,
                        streamer=streamer,
                        max_new_tokens=min(request.max_tokens, self.config.max_new_tokens),
                        temperature=self.config.temperature,
                        top_p=self.config.top_p,
                        top_k=self.config.top_k,
                        repetition_penalty=self.config.repetition_penalty,
                    )
            except Exception as exc:  # pragma: no cover - hardware runtime path.
                errors.append(exc)
                streamer.on_finalized_text("", stream_end=True)

        thread = Thread(target=generate, daemon=True)
        thread.start()
        for chunk in streamer:
            if chunk:
                yield chunk
        thread.join()
        if errors:
            raise RuntimeError(f"Hy-MT2 streaming generation failed: {errors[0]}")

    def _load(self) -> None:
        model_dir = Path(self.config.hymt2_model_dir)
        if not model_dir.exists():
            raise RuntimeError(f"Hy-MT2 model dir does not exist: {model_dir}")
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        dtype = getattr(torch, self.config.hymt2_dtype)
        self.tokenizer = AutoTokenizer.from_pretrained(model_dir, trust_remote_code=True)
        if self.tokenizer.pad_token_id is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        self.tokenizer.padding_side = "left"
        kwargs = {
            "device_map": self.config.hymt2_device_map,
            "trust_remote_code": True,
        }
        try:
            self.model = AutoModelForCausalLM.from_pretrained(
                model_dir,
                dtype=dtype,
                **kwargs,
            )
        except TypeError:
            self.model = AutoModelForCausalLM.from_pretrained(
                model_dir,
                torch_dtype=dtype,
                **kwargs,
            )
        self.model.eval()


def build_prompt(
    text: str,
    target_language: str,
    *,
    previous_segments: tuple[tuple[str, str], ...] = (),
    glossary: tuple[tuple[str, str], ...] = (),
    protected_entities: tuple[str, ...] = (),
) -> str:
    target = TARGET_LANGUAGE_NAMES.get(target_language, target_language)
    sections: list[str] = []
    references = [*glossary, *((entity, entity) for entity in protected_entities)]
    if references:
        terms = "\n".join(
            f"{source} 翻译成 {translated}"
            for source, translated in references
        )
        sections.append(f"参考下面的翻译：\n{terms}")
    if previous_segments:
        context = "\n".join(
            f"{source}\n对应译文：{translated}"
            for source, translated in previous_segments[-2:]
        )
        sections.append(
            f"【背景信息】\n{context}\n\n"
            f"请结合背景信息将以下文本翻译为 {target}，注意只需要输出翻译后的结果，"
            f"不要额外解释：\n\n【待翻译文本】\n{text}"
        )
    else:
        sections.append(
            f"将以下文本翻译为 {target}，注意只需要输出翻译后的结果，不要额外解释："
            f"\n\n{text}"
        )
    return "\n".join(sections)


def as_model_inputs(inputs):
    if isinstance(inputs, Mapping):
        return inputs
    return {"input_ids": inputs}


TARGET_LANGUAGE_NAMES = {
    "zh": "简体中文",
    "en": "英语",
    "fr": "法语",
    "pt": "葡萄牙语",
    "es": "西班牙语",
    "ja": "日语",
    "tr": "土耳其语",
    "ru": "俄语",
    "ar": "阿拉伯语",
    "ko": "韩语",
    "th": "泰语",
    "it": "意大利语",
    "de": "德语",
    "vi": "越南语",
    "ms": "马来语",
    "id": "印尼语",
    "tl": "菲律宾语",
    "hi": "印地语",
    "zh-Hant": "繁体中文",
    "pl": "波兰语",
    "cs": "捷克语",
    "nl": "荷兰语",
    "km": "高棉语",
    "my": "缅甸语",
    "fa": "波斯语",
    "gu": "古吉拉特语",
    "ur": "乌尔都语",
    "te": "泰卢固语",
    "mr": "马拉地语",
    "he": "希伯来语",
    "bn": "孟加拉语",
    "ta": "泰米尔语",
    "uk": "乌克兰语",
    "bo": "藏语",
    "kk": "哈萨克语",
    "mn": "蒙古语",
    "ug": "维吾尔语",
    "yue": "粤语",
}
