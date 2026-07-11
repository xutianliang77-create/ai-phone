#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote


def main():
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    manifest = load_manifest(Path(args.manifest))
    selected = select_models(manifest["models"], args.model)
    dirs = {
        "models": root / "models",
        "logs": root / "logs",
        "outputs": root / "outputs",
    }
    for directory in dirs.values():
        directory.mkdir(parents=True, exist_ok=True)

    status_file = dirs["outputs"] / "resolve-download-status.jsonl"
    failures = []
    for model in selected:
        try:
            result = download_model(model, dirs["models"], dirs["logs"], args)
        except Exception as exc:
            result = {
                "name": model["name"],
                "repo": model["repo"],
                "status": "failed",
                "error": f"{type(exc).__name__}: {exc}",
            }
        write_jsonl(status_file, {**result, "at": now_iso()})
        if result["status"] != "complete":
            failures.append(result)

    report = inspect_models(manifest["models"], dirs["models"])
    report_path = dirs["outputs"] / "download-integrity-report.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"report": str(report_path), "failures": failures}, indent=2))
    return 1 if failures else 0


def parse_args():
    parser = argparse.ArgumentParser(
        description="Download Hugging Face model files through /resolve/ URLs."
    )
    parser.add_argument("--root", default="/data/models/translation-model-eval")
    parser.add_argument("--manifest", default="model_manifest.json")
    parser.add_argument("--endpoint", default="https://hf-mirror.com")
    parser.add_argument("--model", action="append", default=[])
    parser.add_argument("--retry", default="5")
    parser.add_argument("--connect-timeout", default="20")
    parser.add_argument("--speed-time", default="120")
    parser.add_argument("--speed-limit", default="1024")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def load_manifest(path):
    return json.loads(path.read_text())


def select_models(models, names):
    if not names:
        return models
    wanted = set(names)
    return [model for model in models if model["name"] in wanted or model["repo"] in wanted]


def download_model(model, models_dir, logs_dir, args):
    target = models_dir / model["name"]
    repo_url = f"{args.endpoint.rstrip('/')}/{model['repo']}"
    clone_or_update(repo_url, target, args.dry_run)
    pointer_files = list_lfs_pointers(target)
    downloaded = []
    for pointer in pointer_files:
        item = download_pointer_file(model, target, pointer, logs_dir, args)
        downloaded.append(item)
    remaining = list_lfs_pointers(target)
    return {
        "name": model["name"],
        "repo": model["repo"],
        "status": "complete" if not remaining else "partial",
        "pointerFiles": len(pointer_files),
        "downloadedFiles": downloaded,
        "remainingPointers": [str(path.relative_to(target)) for path in remaining],
    }


def clone_or_update(repo_url, target, dry_run):
    env = os.environ.copy()
    env["GIT_LFS_SKIP_SMUDGE"] = "1"
    env["GIT_TERMINAL_PROMPT"] = "0"
    if (target / ".git").exists():
        run(["git", "-C", str(target), "remote", "set-url", "origin", repo_url], dry_run=dry_run)
        run(["git", "-C", str(target), "pull", "--ff-only"], env=env, dry_run=dry_run)
        return
    if target.exists() and any(target.iterdir()):
        raise RuntimeError(f"{target} exists but is not a git checkout")
    target.parent.mkdir(parents=True, exist_ok=True)
    run(["git", "clone", repo_url, str(target)], env=env, dry_run=dry_run)


def list_lfs_pointers(root):
    pointers = []
    for path in root.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        if path.name.endswith(".lfs-pointer") or path.name.endswith(".download"):
            continue
        if is_lfs_pointer(path):
            pointers.append(path)
    return sorted(pointers)


def is_lfs_pointer(path):
    try:
        if path.stat().st_size > 512:
            return False
        head = path.read_bytes()[:200]
    except OSError:
        return False
    return b"version https://git-lfs.github.com/spec/v1" in head and b"oid sha256:" in head


def read_lfs_pointer(path):
    data = {}
    for line in path.read_text().splitlines():
        if line.startswith("oid sha256:"):
            data["sha256"] = line.split(":", 1)[1]
        elif line.startswith("size "):
            data["size"] = int(line.split(" ", 1)[1])
    if "size" not in data:
        raise RuntimeError(f"missing size in LFS pointer: {path}")
    return data


def download_pointer_file(model, target, pointer_path, logs_dir, args):
    pointer = read_lfs_pointer(pointer_path)
    relative = pointer_path.relative_to(target).as_posix()
    url = "/".join(
        [
            args.endpoint.rstrip("/"),
            quote(model["repo"], safe="/"),
            "resolve",
            "main",
            quote(relative, safe="/"),
        ]
    )
    backup = pointer_path.with_suffix(pointer_path.suffix + ".lfs-pointer")
    temp = pointer_path.with_suffix(pointer_path.suffix + ".download")
    if not backup.exists():
        shutil.move(pointer_path, backup)
    if pointer_path.exists() and pointer_path.stat().st_size == pointer["size"]:
        return {"path": relative, "bytes": pointer["size"], "status": "already_complete"}
    log_file = logs_dir / f"curl-{model['name']}.log"
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
    if args.dry_run:
        return {"path": relative, "bytes": pointer["size"], "status": "dry_run"}
    with log_file.open("a") as log:
        log.write(f"\n[{now_iso()}] {' '.join(command)}\n")
        code = subprocess.call(command, stdout=log, stderr=subprocess.STDOUT)
    if code != 0:
        return {"path": relative, "bytes": pointer["size"], "status": "failed", "code": code}
    if not temp.exists() or temp.stat().st_size != pointer["size"]:
        actual = temp.stat().st_size if temp.exists() else 0
        return {
            "path": relative,
            "bytes": pointer["size"],
            "actualBytes": actual,
            "status": "size_mismatch",
        }
    temp.replace(pointer_path)
    return {"path": relative, "bytes": pointer["size"], "status": "complete"}


def inspect_models(models, models_dir):
    return {
        "generatedAt": now_iso(),
        "models": [inspect_model(model, models_dir / model["name"]) for model in models],
    }


def inspect_model(model, target):
    if not target.exists():
        return {**model, "status": "missing", "bytes": 0, "remainingPointers": []}
    pointers = [str(path.relative_to(target)) for path in list_lfs_pointers(target)]
    files = [path for path in target.rglob("*") if path.is_file() and not path.is_symlink()]
    total_bytes = sum(path.stat().st_size for path in files)
    large_files = [
        {
            "path": str(path.relative_to(target)),
            "bytes": path.stat().st_size,
        }
        for path in sorted(files)
        if path.stat().st_size >= 1024 * 1024
    ]
    status = "complete" if not pointers and large_files else "partial"
    return {
        **model,
        "status": status,
        "bytes": total_bytes,
        "remainingPointers": pointers,
        "largeFiles": large_files[:20],
    }


def run(command, env=None, dry_run=False):
    if dry_run:
        print(" ".join(command))
        return
    subprocess.run(command, check=True, env=env)


def write_jsonl(path, payload):
    with path.open("a") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    sys.exit(main())
