#!/usr/bin/env python3
import argparse
import fnmatch
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from huggingface_hub import HfApi


ROOT = Path("/data/models/translation-model-eval/data/translation-product-fit")

MODELS = [
    {
        "name": "hymt2_1_8b_gguf_q4",
        "repo": "tencent/Hy-MT2-1.8B-GGUF",
        "allow": ["Hy-MT2-1.8B-Q4_K_M.gguf", "README.md", "config.json", "tokenizer*"],
    },
    {
        "name": "hymt2_1_8b",
        "repo": "tencent/Hy-MT2-1.8B",
        "ignore": ["train/**", "imgs/**", "*.png", "*.jpg", "*.jpeg"],
    },
    {
        "name": "hymt2_30b_a3b",
        "repo": "tencent/Hy-MT2-30B-A3B",
        "ignore": ["train/**", "imgs/**", "*.png", "*.jpg", "*.jpeg"],
    },
    {"name": "lmt_60_1_7b_base", "repo": "NiuTrans/LMT-60-1.7B-Base"},
    {"name": "madlad400_3b_mt", "repo": "google/madlad400-3b-mt", "ignore": ["*.gguf"]},
    {"name": "seamless_m4t_v2_large", "repo": "facebook/seamless-m4t-v2-large", "ignore": ["*.pt"]},
]


def main():
    args = parse_args()
    root = Path(args.root)
    root.mkdir(parents=True, exist_ok=True)
    (root / "models").mkdir(parents=True, exist_ok=True)
    (root / "logs").mkdir(parents=True, exist_ok=True)
    api = HfApi(endpoint=args.endpoint)
    status = []
    for model in select_models(args.model):
        status.append(download_model(root, api, model, args))
        write_json(root / "download-status.json", status)
    print(json.dumps({"root": str(root), "models": status}, ensure_ascii=False, indent=2))
    return 0 if all(item["status"] == "complete" for item in status) else 1


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=str(ROOT))
    parser.add_argument("--endpoint", default="https://hf-mirror.com")
    parser.add_argument("--model", action="append", default=[])
    parser.add_argument("--retry", default="5")
    parser.add_argument("--connect-timeout", default="20")
    parser.add_argument("--speed-time", default="120")
    parser.add_argument("--speed-limit", default="1024")
    return parser.parse_args()


def select_models(names):
    if not names:
        return MODELS
    wanted = set(names)
    selected = [m for m in MODELS if m["name"] in wanted or m["repo"] in wanted]
    known = {m["name"] for m in selected} | {m["repo"] for m in selected}
    missing = wanted - known
    if missing:
        raise SystemExit(f"unknown model(s): {', '.join(sorted(missing))}")
    return selected


def download_model(root, api, model, args):
    target = root / "models" / model["name"]
    target.mkdir(parents=True, exist_ok=True)
    started = now_iso()
    try:
        siblings = api.model_info(model["repo"], files_metadata=True).siblings
        files = [item for item in siblings if include_file(model, item.rfilename)]
        downloads = [download_file(root, target, model, item, args) for item in files]
        failed = [item for item in downloads if item["status"] != "complete"]
        return {
            "name": model["name"],
            "repo": model["repo"],
            "status": "complete" if not failed else "partial",
            "target": str(target),
            "startedAt": started,
            "finishedAt": now_iso(),
            "fileCount": len(files),
            "bytes": directory_bytes(target),
            "failed": failed,
        }
    except Exception as exc:
        return {
            "name": model["name"],
            "repo": model["repo"],
            "status": "failed",
            "target": str(target),
            "startedAt": started,
            "finishedAt": now_iso(),
            "error": f"{type(exc).__name__}: {exc}",
        }


def include_file(model, path):
    allow = model.get("allow")
    ignore = model.get("ignore", [])
    if allow and not any(fnmatch.fnmatch(path, pattern) for pattern in allow):
        return False
    if any(fnmatch.fnmatch(path, pattern) for pattern in ignore):
        return False
    return True


def download_file(root, target, model, sibling, args):
    path = target / sibling.rfilename
    path.parent.mkdir(parents=True, exist_ok=True)
    expected = getattr(sibling, "size", None) or 0
    if expected and path.exists() and path.stat().st_size == expected:
        return {"path": sibling.rfilename, "bytes": expected, "status": "complete"}
    temp = path.with_suffix(path.suffix + ".download")
    url = "/".join(
        [
            args.endpoint.rstrip("/"),
            quote(model["repo"], safe="/"),
            "resolve",
            "main",
            quote(sibling.rfilename, safe="/"),
        ]
    )
    log_path = root / "logs" / f"curl-{model['name']}.log"
    command = [
        "curl",
        "-L",
        "-C",
        "-",
        "--fail",
        "--retry",
        args.retry,
        "--connect-timeout",
        args.connect_timeout,
        "--speed-time",
        args.speed_time,
        "--speed-limit",
        args.speed_limit,
        "-o",
        str(temp),
        url,
    ]
    with log_path.open("a") as log:
        log.write(f"\n[{now_iso()}] {' '.join(command)}\n")
        code = subprocess.call(command, stdout=log, stderr=subprocess.STDOUT)
    if code != 0:
        return {"path": sibling.rfilename, "bytes": expected, "status": "failed", "code": code}
    if expected and temp.stat().st_size != expected:
        return {
            "path": sibling.rfilename,
            "bytes": expected,
            "actualBytes": temp.stat().st_size,
            "status": "size_mismatch",
        }
    temp.replace(path)
    return {"path": sibling.rfilename, "bytes": expected, "status": "complete"}


def write_json(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def directory_bytes(path):
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def now_iso():
    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    sys.exit(main())
