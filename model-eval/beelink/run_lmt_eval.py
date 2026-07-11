#!/usr/bin/env python3
import json
import os
import time
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer


CASES = [
    {
        "id": "lmt-zh-meeting",
        "source": "今天下午三点我们在会议室讨论产品计划，之后我会整理会议记录发给大家。",
        "prompt": (
            "Translate the following text from Chinese into English:\n"
            "Chinese: 今天下午三点我们在会议室讨论产品计划，之后我会整理会议记录发给大家。\n"
            "English:"
        ),
        "expectedText": (
            "At three o'clock this afternoon, we will discuss the product plan "
            "in the meeting room. After that, I will organize the meeting notes "
            "and send them to everyone."
        ),
    },
    {
        "id": "lmt-en-question",
        "source": "What is your name?",
        "prompt": (
            "Translate the following text from English into Chinese:\n"
            "English: What is your name?\n"
            "Chinese:"
        ),
        "expectedText": "你叫什么名字？",
    },
    {
        "id": "lmt-terms-number",
        "source": "SKU A-120 的报价是 20000 元，请在周五前发送报关资料。",
        "prompt": (
            "Translate the following text from Chinese into English. "
            "Keep product codes, numbers and dates unchanged:\n"
            "Chinese: SKU A-120 的报价是 20000 元，请在周五前发送报关资料。\n"
            "English:"
        ),
        "expectedText": (
            "The quotation for SKU A-120 is 20,000 yuan. Please send the customs "
            "declaration materials before Friday."
        ),
    },
    {
        "id": "lmt-en-business",
        "source": "Please confirm the hotel address and send me the invoice after the meeting.",
        "prompt": (
            "Translate the following text from English into Chinese:\n"
            "English: Please confirm the hotel address and send me the invoice after the meeting.\n"
            "Chinese:"
        ),
        "expectedText": "请确认酒店地址，并在会议结束后把发票发给我。",
    },
    {
        "id": "lmt-code-switch",
        "source": "What's your name? 你叫什么名字？",
        "prompt": (
            "Translate the following mixed Chinese-English text into Chinese:\n"
            "Text: What's your name? 你叫什么名字？\n"
            "Chinese:"
        ),
        "expectedText": "你叫什么名字？",
    },
]


def main():
    root = Path(os.environ.get("MODEL_EVAL_ROOT", "/data/models/translation-model-eval"))
    model_dir = root / "models" / "lmt_60_0_6b"
    output_dir = root / "outputs"
    output_dir.mkdir(parents=True, exist_ok=True)
    os.environ["TRANSFORMERS_OFFLINE"] = "1"

    tokenizer = AutoTokenizer.from_pretrained(
        str(model_dir),
        padding_side="left",
        local_files_only=True,
    )
    model = AutoModelForCausalLM.from_pretrained(
        str(model_dir),
        local_files_only=True,
        torch_dtype="auto",
    )
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.eval().to(device)

    records = [run_case(model, tokenizer, device, item) for item in CASES]
    payload = {
        "provider": "local_transformers",
        "model": "NiuTrans/LMT-60-0.6B",
        "records": records,
    }
    (output_dir / "lmt-eval-records.json").write_text(
        json.dumps(records, indent=2, ensure_ascii=False) + "\n"
    )
    (output_dir / "lmt-eval-summary.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    )
    print(json.dumps(payload, indent=2, ensure_ascii=False))


def run_case(model, tokenizer, device, item):
    text = tokenizer.apply_chat_template(
        [{"role": "user", "content": item["prompt"]}],
        tokenize=False,
        add_generation_prompt=True,
    )
    inputs = tokenizer([text], return_tensors="pt").to(device)
    if torch.cuda.is_available():
        torch.cuda.synchronize()
    start = time.perf_counter()
    with torch.inference_mode():
        generated = model.generate(
            **inputs,
            max_new_tokens=180,
            num_beams=1,
            do_sample=False,
        )
    if torch.cuda.is_available():
        torch.cuda.synchronize()
    output_ids = generated[0][len(inputs.input_ids[0]):].tolist()
    return {
        "id": item["id"],
        "type": "translation",
        "provider": "local_transformers",
        "model": "NiuTrans/LMT-60-0.6B",
        "sourceText": item["source"],
        "expectedText": item["expectedText"],
        "actualText": tokenizer.decode(output_ids, skip_special_tokens=True).strip(),
        "latencyMs": round((time.perf_counter() - start) * 1000),
    }


if __name__ == "__main__":
    main()
