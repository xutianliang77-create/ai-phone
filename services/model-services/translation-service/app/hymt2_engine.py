from collections.abc import Mapping
from pathlib import Path

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
        if self._load_error or self.tokenizer is None or self.model is None:
            raise RuntimeError(self._load_error or "Hy-MT2 model is not loaded")
        import torch

        prompt = build_prompt(request.text, request.target_language)
        messages = [{"role": "user", "content": prompt}]
        inputs = self.tokenizer.apply_chat_template(
            messages,
            add_generation_prompt=True,
            return_tensors="pt",
        ).to(self.model.device)
        model_inputs = as_model_inputs(inputs)
        with torch.no_grad():
            outputs = self.model.generate(
                **model_inputs,
                max_new_tokens=min(request.max_tokens, self.config.max_new_tokens),
                temperature=self.config.temperature,
                top_p=self.config.top_p,
                top_k=self.config.top_k,
                repetition_penalty=self.config.repetition_penalty,
            )
        prompt_tokens = model_inputs["input_ids"].shape[-1]
        response = self.tokenizer.decode(
            outputs[0][prompt_tokens:],
            skip_special_tokens=True,
        )
        return response.strip()

    def _load(self) -> None:
        model_dir = Path(self.config.hymt2_model_dir)
        if not model_dir.exists():
            raise RuntimeError(f"Hy-MT2 model dir does not exist: {model_dir}")
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        dtype = getattr(torch, self.config.hymt2_dtype)
        self.tokenizer = AutoTokenizer.from_pretrained(model_dir, trust_remote_code=True)
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


def build_prompt(text: str, target_language: str) -> str:
    target = TARGET_LANGUAGE_NAMES.get(target_language, target_language)
    return (
        f"将以下文本翻译为 {target}，注意只需要输出翻译后的结果，不要额外解释：\n\n"
        f"{text}"
    )


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
