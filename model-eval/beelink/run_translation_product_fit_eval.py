#!/usr/bin/env python3
import argparse
import gc
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoModelForSeq2SeqLM, AutoTokenizer


ROOT = Path("/data/models/translation-model-eval/data/translation-product-fit")
GPU_MEMORY_LIMIT = "9GiB"

CASES = [
    {
        "id": "zh_short_meeting",
        "sourceLang": "zh",
        "targetLang": "en",
        "text": "今天下午三点我们讨论产品计划。",
        "keywords": ["three", "product", "plan"],
    },
    {
        "id": "en_short_name",
        "sourceLang": "en",
        "targetLang": "zh",
        "text": "What is your name?",
        "keywords": ["名字"],
    },
    {
        "id": "zh_long_meeting",
        "sourceLang": "zh",
        "targetLang": "en",
        "text": "今天下午三点，我们在会议室讨论产品计划。之后我会整理会议记录，并在下班前发给大家确认。",
        "keywords": ["three", "meeting", "product", "plan", "notes"],
    },
    {
        "id": "en_support_call",
        "sourceLang": "en",
        "targetLang": "zh",
        "text": "Please confirm the hotel address and send me the invoice after the meeting.",
        "keywords": ["酒店", "地址", "发票", "会议"],
    },
    {
        "id": "zh_terms_sku_money",
        "sourceLang": "zh",
        "targetLang": "en",
        "text": "SKU A-120 的报价是 20000 元，请在周五前发送报关资料。",
        "keywords": ["quotation", "customs", "Friday"],
        "protectedTerms": ["SKU A-120", "20000"],
    },
    {
        "id": "zh_address_phone",
        "sourceLang": "zh",
        "targetLang": "en",
        "text": "收货地址是北京市朝阳区建国路88号，联系人李明，电话13800138000。",
        "keywords": ["Beijing", "Chaoyang", "contact"],
        "protectedTerms": ["88", "13800138000"],
    },
    {
        "id": "mixed_to_zh_dedupe",
        "sourceLang": "mixed",
        "targetLang": "zh",
        "text": "What's your name? 你叫什么名字？",
        "keywords": ["名字"],
    },
    {
        "id": "mixed_to_en_auto",
        "sourceLang": "mixed",
        "targetLang": "en",
        "text": "This is an automation language detection test，自动识别语言。",
        "keywords": ["automation", "language", "detection"],
    },
    {
        "id": "asr_dirty_zh_no_punct",
        "sourceLang": "zh",
        "targetLang": "en",
        "text": "今天我们测试自动识别语言重点看中文英文是否能够自动反向翻译",
        "keywords": ["test", "language", "automatic", "translation"],
    },
    {
        "id": "asr_dirty_dup",
        "sourceLang": "zh",
        "targetLang": "en",
        "text": "你好你好你是谁呀 你好你是谁呀",
        "keywords": ["hello", "who", "you"],
    },
    {
        "id": "json_format",
        "sourceLang": "zh",
        "targetLang": "en",
        "text": "{\"title\":\"会议纪要\",\"amount\":\"20000\",\"owner\":\"李明\"}",
        "keywords": ["meeting", "minutes"],
        "protectedTerms": ["20000", "owner", "title", "amount"],
        "formatSensitive": True,
    },
    {
        "id": "subtitle_delimiter",
        "sourceLang": "en",
        "targetLang": "zh",
        "text": "Please wait || I will call customer service || The order number is A-120.",
        "keywords": ["等待", "客服", "订单"],
        "protectedTerms": ["||", "A-120"],
    },
]

MODELS = [
    {"name": "lmt_60_0_6b", "kind": "causal", "path": "/data/models/translation-model-eval/models/lmt_60_0_6b"},
    {"name": "lmt_60_1_7b_base", "kind": "causal"},
    {"name": "hymt2_1_8b", "kind": "causal", "trustRemoteCode": True},
    {
        "name": "hymt2_30b_a3b",
        "kind": "causal",
        "trustRemoteCode": True,
        "gpuMemoryLimit": "24GiB",
        "cpuMemoryLimit": "88GiB",
    },
    {"name": "madlad400_3b_mt", "kind": "seq2seq"},
    {"name": "seamless_m4t_v2_large", "kind": "seamless"},
    {"name": "hymt2_1_8b_gguf_q4", "kind": "gguf"},
]


def main():
    args = parse_args()
    root = Path(args.root)
    output = root / "outputs"
    output.mkdir(parents=True, exist_ok=True)
    write_samples(root)
    selected = [m for m in MODELS if not args.model or m["name"] in set(args.model)]
    results = []
    for spec in selected:
        results.extend(run_model(root, spec, args.limit))
        cleanup()
        write_json(output / "generation-results.json", results)
        write_summary(root, results)
    write_errors(root, results)
    print(json.dumps({"results": len(results), "summary": str(output / "score-summary.json")}, ensure_ascii=False))


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=str(ROOT))
    parser.add_argument("--model", action="append", default=[])
    parser.add_argument("--limit", type=int, default=0)
    return parser.parse_args()


def run_model(root, spec, limit):
    cases = CASES[: limit or None]
    model_dir = Path(spec.get("path") or root / "models" / spec["name"])
    if not model_dir.exists():
        return [failure(spec, case, "model_dir_missing", f"{model_dir} does not exist") for case in cases]
    if spec["kind"] == "gguf":
        return run_gguf_probe(model_dir, spec, cases)
    try:
        before_gpu = gpu_memory_mb()
        engine = load_engine(spec, model_dir)
        after_gpu = gpu_memory_mb()
    except Exception as exc:
        return [failure(spec, case, "load_failed", f"{type(exc).__name__}: {exc}") for case in cases]
    records = []
    for case in cases:
        records.append(run_case(engine, spec, case, before_gpu, after_gpu))
    del engine
    cleanup()
    after_unload = gpu_memory_mb()
    for record in records:
        record["gpuMemoryAfterUnloadMb"] = after_unload
    return records


def load_engine(spec, model_dir):
    if spec["kind"] == "seq2seq":
        tokenizer = AutoTokenizer.from_pretrained(str(model_dir), local_files_only=True)
        model = AutoModelForSeq2SeqLM.from_pretrained(
            str(model_dir),
            local_files_only=True,
            device_map="auto",
            max_memory=max_memory(spec),
            torch_dtype=torch.float16 if torch.cuda.is_available() else None,
        )
        model.eval()
        return {"tokenizer": tokenizer, "model": model}
    if spec["kind"] == "seamless":
        from transformers import AutoProcessor, SeamlessM4Tv2Model

        processor = AutoProcessor.from_pretrained(str(model_dir), local_files_only=True)
        model = SeamlessM4Tv2Model.from_pretrained(
            str(model_dir),
            local_files_only=True,
            device_map="auto",
            max_memory=max_memory(spec),
            torch_dtype=torch.float16 if torch.cuda.is_available() else None,
        )
        model.eval()
        return {"processor": processor, "model": model}
    tokenizer = AutoTokenizer.from_pretrained(
        str(model_dir),
        local_files_only=True,
        padding_side="left",
        trust_remote_code=spec.get("trustRemoteCode", False),
    )
    model = AutoModelForCausalLM.from_pretrained(
        str(model_dir),
        local_files_only=True,
        device_map="auto",
        max_memory=max_memory(spec),
        torch_dtype=torch.bfloat16 if torch.cuda.is_available() else None,
        trust_remote_code=spec.get("trustRemoteCode", False),
    )
    model.eval()
    return {"tokenizer": tokenizer, "model": model}


def run_case(engine, spec, case, before_gpu, after_gpu):
    try:
        if torch.cuda.is_available():
            torch.cuda.synchronize()
        started = time.perf_counter()
        if spec["kind"] == "seq2seq":
            text = translate_seq2seq(engine, case)
        elif spec["kind"] == "seamless":
            text = translate_seamless(engine, case)
        else:
            text = translate_causal(engine, spec, case)
        if torch.cuda.is_available():
            torch.cuda.synchronize()
        latency = round((time.perf_counter() - started) * 1000)
        record = base_record(spec, case, "complete")
        record.update(
            {
                "actualText": clean_text(text),
                "latencyMs": latency,
                "gpuMemoryBeforeLoadMb": before_gpu,
                "gpuMemoryAfterLoadMb": after_gpu,
                "gpuMemoryAfterCaseMb": gpu_memory_mb(),
                "gpuMemoryLimit": spec.get("gpuMemoryLimit", GPU_MEMORY_LIMIT),
                "cpuMemoryLimit": spec.get("cpuMemoryLimit", "80GiB"),
            }
        )
        record.update(score(record, case))
        return record
    except Exception as exc:
        return failure(spec, case, "generation_failed", f"{type(exc).__name__}: {exc}")


def translate_causal(engine, spec, case):
    tokenizer = engine["tokenizer"]
    model = engine["model"]
    prompt = build_prompt(case, spec["name"])
    messages = [{"role": "user", "content": prompt}]
    if hasattr(tokenizer, "apply_chat_template"):
        text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    else:
        text = prompt
    batch = tokenizer([text], return_tensors="pt").to(first_device(model))
    batch.pop("token_type_ids", None)
    with torch.inference_mode():
        output = model.generate(**batch, max_new_tokens=220, num_beams=1, do_sample=False)
    output_ids = output[0][len(batch.input_ids[0]) :].tolist()
    return tokenizer.decode(output_ids, skip_special_tokens=True)


def translate_seq2seq(engine, case):
    tokenizer = engine["tokenizer"]
    model = engine["model"]
    lang = "en" if case["targetLang"] == "en" else "zh"
    prompt = f"<2{lang}> {case['text']}"
    batch = tokenizer(prompt, return_tensors="pt").to(first_device(model))
    with torch.inference_mode():
        output = model.generate(**batch, max_new_tokens=220, num_beams=1, do_sample=False)
    return tokenizer.decode(output[0], skip_special_tokens=True)


def translate_seamless(engine, case):
    processor = engine["processor"]
    model = engine["model"]
    src_lang = "eng" if case["sourceLang"] == "en" else "cmn"
    tgt_lang = "eng" if case["targetLang"] == "en" else "cmn"
    batch = processor(text=case["text"], src_lang=src_lang, return_tensors="pt").to(first_device(model))
    with torch.inference_mode():
        output = model.generate(**batch, tgt_lang=tgt_lang, generate_speech=False)
    tokens = output[0].tolist() if hasattr(output, "tolist") else output.sequences[0].tolist()
    return processor.decode(tokens, skip_special_tokens=True)


def run_gguf_probe(model_dir, spec, cases):
    ggufs = sorted(model_dir.glob("*.gguf"))
    detail = "no gguf file found" if not ggufs else f"gguf present: {ggufs[0].name}"
    runtime = first_runtime()
    status = "runtime_missing" if runtime is None else "runtime_not_integrated"
    return [failure(spec, case, status, f"{detail}; runtime={runtime or 'none'}") for case in cases]


def build_prompt(case, model_name):
    target = "English" if case["targetLang"] == "en" else "Chinese"
    if case.get("formatSensitive"):
        return (
            f"Translate the user-facing values into {target}. Preserve JSON keys, numbers, "
            f"punctuation and structure. Only output the translated data:\n{case['text']}"
        )
    if case["sourceLang"] == "mixed":
        return (
            f"Translate this mixed Chinese-English text into {target}. Merge duplicate meaning. "
            f"Only output the translation, no explanation:\n{case['text']}"
        )
    if case["targetLang"] == "en":
        return f"Translate the following text from Chinese into English:\nChinese: {case['text']}\nEnglish:"
    return f"Translate the following text from English into Chinese:\nEnglish: {case['text']}\nChinese:"


def score(record, case):
    text = record.get("actualText", "")
    keywords = case.get("keywords", [])
    protected = case.get("protectedTerms", [])
    keyword_hits = sum(1 for item in keywords if contains(text, item))
    protected_hits = sum(1 for item in protected if contains(text, item))
    language_ok = target_language_ok(text, case["targetLang"])
    no_extra = not re.search(r"(translation|译文|解释|here is|以下是)", text, re.I)
    keyword_rate = keyword_hits / max(1, len(keywords))
    protected_rate = protected_hits / max(1, len(protected)) if protected else 1.0
    usable = bool(text.strip()) and language_ok and no_extra and keyword_rate >= 0.5 and protected_rate >= 0.95
    return {
        "keywordHitRate": round(keyword_rate, 3),
        "protectedTermRate": round(protected_rate, 3),
        "languageOk": language_ok,
        "noExtraExplanation": no_extra,
        "passed": usable,
    }


def target_language_ok(text, target):
    cjk = len(re.findall(r"[\u4e00-\u9fff]", text))
    latin = len(re.findall(r"[A-Za-z]", text))
    if target == "zh":
        return cjk >= 1 and cjk >= latin * 0.35
    return latin >= 3 and latin >= cjk


def contains(text, needle):
    return normalize(needle) in normalize(text)


def normalize(text):
    return re.sub(r"\s+", "", text).lower().replace(",", "")


def clean_text(text):
    return text.strip().strip("\"'`")


def base_record(spec, case, status):
    return {
        "id": case["id"],
        "type": "translation",
        "provider": "beelink_local",
        "model": spec["name"],
        "status": status,
        "sourceLang": case["sourceLang"],
        "targetLang": case["targetLang"],
        "sourceText": case["text"],
    }


def failure(spec, case, status, error):
    record = base_record(spec, case, status)
    record.update({"actualText": "", "latencyMs": None, "error": error, "passed": False})
    return record


def write_samples(root):
    path = root / "samples.jsonl"
    path.write_text("\n".join(json.dumps(item, ensure_ascii=False) for item in CASES) + "\n")


def write_summary(root, results):
    summary = {"generatedAt": now_iso(), "models": []}
    for name in sorted({item["model"] for item in results}):
        items = [item for item in results if item["model"] == name]
        latencies = sorted(item["latencyMs"] for item in items if item.get("latencyMs") is not None)
        summary["models"].append(
            {
                "model": name,
                "total": len(items),
                "passed": sum(1 for item in items if item.get("passed")),
                "passRate": round(sum(1 for item in items if item.get("passed")) / max(1, len(items)), 3),
                "p50LatencyMs": percentile(latencies, 50),
                "p95LatencyMs": percentile(latencies, 95),
                "gpuMemoryLimit": first_value(item.get("gpuMemoryLimit") for item in items) or GPU_MEMORY_LIMIT,
                "cpuMemoryLimit": first_value(item.get("cpuMemoryLimit") for item in items) or "80GiB",
                "maxGpuMemoryAfterLoadMb": max_number(item.get("gpuMemoryAfterLoadMb") for item in items),
                "maxGpuMemoryAfterCaseMb": max_number(item.get("gpuMemoryAfterCaseMb") for item in items),
                "gpuMemoryAfterUnloadMb": max_number(item.get("gpuMemoryAfterUnloadMb") for item in items),
                "failedStatuses": sorted({item["status"] for item in items if not item.get("passed")}),
            }
        )
    write_json(root / "outputs" / "score-summary.json", summary)


def write_errors(root, results):
    errors = [item for item in results if not item.get("passed")]
    path = root / "outputs" / "error-cases.jsonl"
    path.write_text("\n".join(json.dumps(item, ensure_ascii=False) for item in errors) + "\n")


def percentile(values, pct):
    if not values:
        return None
    index = min(len(values) - 1, round((pct / 100) * (len(values) - 1)))
    return values[index]


def max_number(values):
    numbers = [item for item in values if isinstance(item, (int, float))]
    return max(numbers) if numbers else None


def first_value(values):
    return next((item for item in values if item), None)


def write_json(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def first_device(model):
    return next(model.parameters()).device


def first_runtime():
    for command in ["llama-cli", "llama", "ollama"]:
        found = subprocess.run(["bash", "-lc", f"command -v {command}"], capture_output=True, text=True)
        if found.returncode == 0 and found.stdout.strip():
            return command
    return None


def max_memory(spec=None):
    if not torch.cuda.is_available():
        return None
    spec = spec or {}
    return {
        0: spec.get("gpuMemoryLimit", GPU_MEMORY_LIMIT),
        "cpu": spec.get("cpuMemoryLimit", "80GiB"),
    }


def gpu_memory_mb():
    if not torch.cuda.is_available():
        return None
    try:
        return round(torch.cuda.memory_allocated() / 1024 / 1024)
    except Exception:
        return None


def cleanup():
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    main()
