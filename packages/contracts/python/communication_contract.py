from __future__ import annotations

from datetime import datetime
from copy import deepcopy
from typing import Any

OPTIONAL_IDS = (
    "speechId",
    "participantId",
    "roomId",
    "legId",
    "turnId",
    "segmentId",
    "playbackId",
    "agentRunId",
    "providerOperationId",
)


def parse_command(value: Any) -> dict[str, Any]:
    envelope = _envelope(value, "command")
    _text(envelope, "commandId")
    _integer(envelope, "expectedVersion", 0)
    _timestamp(envelope, "issuedAt")
    if "deadlineAt" in envelope:
        _timestamp(envelope, "deadlineAt")
    actor = _object(envelope.get("actor"), "actor")
    if actor.get("type") not in {"user", "service", "agent", "system"}:
        raise ValueError("Invalid communication actor type")
    _text(actor, "id")
    return envelope


def parse_event(value: Any) -> dict[str, Any]:
    envelope = _envelope(value, "event")
    _text(envelope, "eventId")
    _text(envelope, "eventType")
    _integer(envelope, "eventVersion", 1)
    _integer(envelope, "aggregateVersion", 0)
    _integer(envelope, "sequence", 0)
    _timestamp(envelope, "occurredAt")
    _text(envelope, "producer")
    _text(envelope, "traceId")
    return envelope


def _envelope(value: Any, kind: str) -> dict[str, Any]:
    envelope = deepcopy(_object(value, kind))
    if envelope.get("contractVersion") != 1:
        raise ValueError("Unsupported communication contractVersion")
    if envelope.get("kind") != kind:
        raise ValueError(f"Invalid communication {kind} kind")
    _text(envelope, "sessionId")
    _text(envelope, "idempotencyKey", 240)
    if "payload" not in envelope:
        raise ValueError("Communication payload is required")
    for name in OPTIONAL_IDS:
        if name in envelope:
            _text(envelope, name)
    return envelope


def _object(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"Invalid communication {name}")
    return value


def _text(value: dict[str, Any], name: str, maximum: int = 160) -> str:
    item = value.get(name)
    if not isinstance(item, str) or not item.strip() or len(item) > maximum:
        raise ValueError(f"Invalid communication {name}")
    normalized = item.strip()
    value[name] = normalized
    return normalized


def _integer(value: dict[str, Any], name: str, minimum: int) -> int:
    item = value.get(name)
    if isinstance(item, bool) or not isinstance(item, int) or item < minimum:
        raise ValueError(f"Invalid communication {name}")
    return item


def _timestamp(value: dict[str, Any], name: str) -> str:
    item = _text(value, name, 64)
    try:
        datetime.fromisoformat(item.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"Invalid communication {name}") from error
    return item
