import base64
import json
from pathlib import Path
import tempfile
from typing import Protocol


def require_local_checkpoint(model_id: str) -> Path:
    path = Path(model_id)
    if not path.is_file():
        raise FileNotFoundError(f"Voice identity checkpoint is missing: {model_id}")
    return path


class VoiceIdentityEngine(Protocol):
    @property
    def available(self) -> bool: ...
    async def enroll(self, identity_id: str, audio_base64: str) -> str: ...
    async def match(
        self, audio_base64: str, candidate_refs: list[str], threshold: float
    ) -> tuple[str | None, float]: ...
    async def delete(self, embedding_ref: str) -> None: ...


class DisabledVoiceIdentityEngine:
    available = False

    async def enroll(self, identity_id: str, audio_base64: str) -> str:
        raise RuntimeError("voice identity provider is not configured")

    async def match(self, audio_base64: str, candidate_refs: list[str], threshold: float):
        raise RuntimeError("voice identity provider is not configured")

    async def delete(self, embedding_ref: str) -> None:
        return None


class NemoVoiceIdentityEngine:
    def __init__(self, model_id: str, store_dir: str, encryption_key: str) -> None:
        if not encryption_key:
            raise ValueError("VOICE_IDENTITY_ENCRYPTION_KEY is required")
        from cryptography.fernet import Fernet

        self._fernet = Fernet(encryption_key.encode("ascii"))
        self._model_id = model_id
        self._store = Path(store_dir)
        self._model = None

    @property
    def available(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        self._load_model()

    async def enroll(self, identity_id: str, audio_base64: str) -> str:
        embedding = self._embedding(audio_base64)
        self._store.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(embedding).encode("utf-8")
        self._path(identity_id).write_bytes(self._fernet.encrypt(payload))
        return identity_id

    async def match(
        self, audio_base64: str, candidate_refs: list[str], threshold: float
    ) -> tuple[str | None, float]:
        import numpy as np

        query = np.asarray(self._embedding(audio_base64), dtype=np.float32)
        best_ref, best_score = None, 0.0
        for ref in candidate_refs:
            path = self._path(ref)
            if not path.exists():
                continue
            stored = json.loads(self._fernet.decrypt(path.read_bytes()))
            candidate = np.asarray(stored, dtype=np.float32)
            score = float(np.dot(query, candidate))
            if score > best_score:
                best_ref, best_score = ref, score
        return (best_ref if best_score >= threshold else None), best_score

    async def delete(self, embedding_ref: str) -> None:
        self._path(embedding_ref).unlink(missing_ok=True)

    def _embedding(self, audio_base64: str) -> list[float]:
        import numpy as np
        import torch

        audio = base64.b64decode(audio_base64, validate=True)
        if len(audio) < 44 or audio[0:4] != b"RIFF" or audio[8:12] != b"WAVE":
            raise ValueError("voice identity audio must be WAV")
        model = self._load_model()
        with tempfile.NamedTemporaryFile(suffix=".wav") as handle:
            handle.write(audio)
            handle.flush()
            with torch.no_grad():
                embedding = model.get_embedding(handle.name)
        vector = embedding.detach().cpu().numpy().reshape(-1).astype(np.float32)
        norm = float(np.linalg.norm(vector))
        if norm <= 0:
            raise ValueError("empty voice identity embedding")
        return (vector / norm).tolist()

    def _load_model(self):
        if self._model is not None:
            return self._model
        path = require_local_checkpoint(self._model_id)
        from nemo.collections.asr.models import EncDecSpeakerLabelModel

        self._model = EncDecSpeakerLabelModel.restore_from(str(path))
        self._model.eval()
        return self._model

    def _path(self, embedding_ref: str) -> Path:
        if not embedding_ref.replace("-", "").replace("_", "").isalnum():
            raise ValueError("invalid embedding reference")
        return self._store / f"{embedding_ref}.fernet"
