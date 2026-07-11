# Beelink Model Evaluation

Workspace on Beelink:

```bash
cd /data/models/translation-model-eval
```

The normal `git lfs pull` path can fail when `hf-mirror` redirects large
objects to an unresolvable `us.aws.cdn.hf-mirror.org` host. Use the resolve
downloader instead:

```bash
python3 scripts/download_resolve_models.py \
  --root /data/models/translation-model-eval \
  --manifest scripts/model_manifest.json
```

Check download integrity:

```bash
python3 scripts/inspect_downloads.py \
  --root /data/models/translation-model-eval \
  --manifest scripts/model_manifest.json \
  --json
```

Outputs:

- `outputs/resolve-download-status.jsonl`
- `outputs/download-integrity-report.json`
- `logs/curl-*.log`
