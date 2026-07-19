from dataclasses import dataclass
from hashlib import sha256
from hmac import compare_digest
import json

from fastapi import HTTPException

TRANSLATION_GAUGES = (
    ("active", "wujie_translation_active"),
    ("waiting", "wujie_translation_waiting"),
    ("pending", "wujie_translation_pending"),
)
TRANSLATION_COUNTERS = (
    ("batches", "wujie_translation_batches_total"),
    ("completed", "wujie_translation_completed_total"),
    ("rejected", "wujie_translation_rejected_total"),
    ("timed_out", "wujie_translation_timed_out_total"),
)


@dataclass(frozen=True)
class RuntimeIdentity:
    service: str
    provider: str
    model_version: str
    fingerprint: str
    signature_version: int = 1


def build_runtime_identity(
    service: str,
    provider: str,
    model_version: str,
    parameters: dict[str, object],
) -> RuntimeIdentity:
    payload = {
        "signatureVersion": 1,
        "service": service,
        "provider": provider,
        "modelVersion": model_version,
        "parameters": parameters,
    }
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return RuntimeIdentity(
        service=service,
        provider=provider,
        model_version=model_version,
        fingerprint=sha256(canonical.encode("utf-8")).hexdigest(),
    )


def require_metrics_token(
    expected: str,
    authorization: str | None,
) -> None:
    if not expected:
        raise HTTPException(status_code=503, detail="Metrics bearer token not configured")
    prefix = "Bearer "
    if not authorization or not authorization.startswith(prefix):
        raise HTTPException(status_code=401, detail="Metrics bearer token required")
    if not compare_digest(authorization[len(prefix):], expected):
        raise HTTPException(status_code=403, detail="Invalid metrics bearer token")


def prometheus_model_metrics(
    identity: RuntimeIdentity,
    available: bool,
    capacity: dict[str, int] | None = None,
) -> str:
    labels = ",".join([
        f'service="{_escape(identity.service)}"',
        f'provider="{_escape(identity.provider)}"',
        f'model_version="{_escape(identity.model_version)}"',
        f'runtime_fingerprint="{identity.fingerprint}"',
        f'signature_version="{identity.signature_version}"',
    ])
    lines = [
        "# HELP wujie_model_service_info Model runtime identity selected at startup.",
        "# TYPE wujie_model_service_info gauge",
        f"wujie_model_service_info{{{labels}}} 1",
        "# HELP wujie_model_service_up Whether the selected model runtime is available.",
        "# TYPE wujie_model_service_up gauge",
        f"wujie_model_service_up{{{labels}}} {1 if available else 0}",
    ]
    if capacity is not None:
        for capacity_key, metric_name in TRANSLATION_GAUGES:
            lines.extend([
                f"# TYPE {metric_name} gauge",
                f"{metric_name} {capacity[capacity_key]}",
            ])
        for capacity_key, metric_name in TRANSLATION_COUNTERS:
            lines.extend([
                f"# TYPE {metric_name} counter",
                f"{metric_name} {capacity[capacity_key]}",
            ])
    return "\n".join([*lines, ""])


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')
