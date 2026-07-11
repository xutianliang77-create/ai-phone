#!/usr/bin/env python3
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/data/models/translation-model-eval")
    parser.add_argument("--manifest", default="model_manifest.json")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    root = Path(args.root).expanduser().resolve()
    manifest = json.loads(Path(args.manifest).read_text())
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "root": str(root),
        "models": [
            inspect_model(model, root / "models" / model["name"])
            for model in manifest["models"]
        ],
    }
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        for item in report["models"]:
            print(
                f"{item['name']}: {item['status']} "
                f"bytes={item['bytes']} pointers={len(item['remainingPointers'])}"
            )
    return 0 if all(item["status"] == "complete" for item in report["models"]) else 1


def inspect_model(model, target):
    if not target.exists():
        return {**model, "status": "missing", "bytes": 0, "remainingPointers": []}
    files = [path for path in target.rglob("*") if path.is_file() and not path.is_symlink()]
    pointers = [str(path.relative_to(target)) for path in files if is_lfs_pointer(path)]
    total_bytes = sum(path.stat().st_size for path in files)
    large_files = [
        {"path": str(path.relative_to(target)), "bytes": path.stat().st_size}
        for path in files
        if path.stat().st_size >= 1024 * 1024
    ]
    return {
        **model,
        "status": "complete" if large_files and not pointers else "partial",
        "bytes": total_bytes,
        "remainingPointers": sorted(pointers),
        "largeFiles": sorted(large_files, key=lambda item: item["path"]),
    }


def is_lfs_pointer(path):
    if path.name.endswith(".lfs-pointer") or path.name.endswith(".download"):
        return False
    try:
        if path.stat().st_size > 512:
            return False
        head = path.read_bytes()[:200]
    except OSError:
        return False
    return b"version https://git-lfs.github.com/spec/v1" in head and b"oid sha256:" in head


if __name__ == "__main__":
    raise SystemExit(main())
