from dataclasses import dataclass
import json
from pathlib import Path

from app.schemas import (
    TtsSynthesizeRequest,
    TtsVoiceConfig,
    VoicePresetCatalogResponse,
    VoicePresetDescriptor,
)


@dataclass(frozen=True)
class VoicePresetRecord:
    descriptor: VoicePresetDescriptor
    reference_audio_id: str
    reference_transcript: str


class VoicePresetCatalog:
    def __init__(
        self,
        *,
        version: str = "unconfigured",
        default_preset_id: str | None = None,
        records: tuple[VoicePresetRecord, ...] = (),
    ) -> None:
        self.version = version
        self._records = {record.descriptor.id: record for record in records}
        self.default_preset_id = (
            default_preset_id if default_preset_id in self._records
            else next(iter(self._records), None)
        )

    @classmethod
    def load(cls, manifest_path: str, reference_dir: str) -> "VoicePresetCatalog":
        if not manifest_path or not reference_dir:
            return cls()
        path = Path(manifest_path)
        if not path.is_file():
            return cls()
        raw = json.loads(path.read_text(encoding="utf-8"))
        version = required_text(raw, "version")
        reference_root = Path(reference_dir)
        records = tuple(
            record for item in raw.get("presets", [])
            if (record := parse_record(item, version, reference_root)) is not None
        )
        return cls(
            version=version,
            default_preset_id=raw.get("defaultPresetId"),
            records=records,
        )

    def response(self) -> VoicePresetCatalogResponse:
        return VoicePresetCatalogResponse(
            version=self.version,
            defaultPresetId=self.default_preset_id,
            presets=[record.descriptor for record in self._records.values()],
        )

    def resolve_request(self, request: TtsSynthesizeRequest) -> TtsSynthesizeRequest:
        voice = request.voice
        if not voice or voice.mode != "preset":
            return request
        preset_id = voice.presetId or self.default_preset_id
        if not preset_id:
            raise ValueError("No natural voice preset is available")
        record = self._records.get(preset_id)
        if record is None:
            raise ValueError(f"Unsupported natural voice preset: {preset_id}")
        resolved_voice = TtsVoiceConfig(
            mode="preset",
            presetId=preset_id,
            voiceProfileId=preset_id,
            referenceAudioId=record.reference_audio_id,
            referenceTranscript=record.reference_transcript,
        )
        return request.model_copy(update={"voice": resolved_voice})


def parse_record(
    raw: object,
    catalog_version: str,
    reference_root: Path,
) -> VoicePresetRecord | None:
    if not isinstance(raw, dict):
        return None
    reference_audio_id = required_text(raw, "referenceAudioId")
    if not (reference_root / f"{reference_audio_id}.wav").is_file():
        return None
    descriptor = VoicePresetDescriptor(
        id=required_text(raw, "id"),
        labels=raw.get("labels", {}),
        gender=raw.get("gender"),
        tone=raw.get("tone"),
        scenario=raw.get("scenario"),
        accent=raw.get("accent"),
        languages=raw.get("languages", []),
        provider="voxcpm2",
        model="VoxCPM2",
        version=catalog_version,
    )
    return VoicePresetRecord(
        descriptor=descriptor,
        reference_audio_id=reference_audio_id,
        reference_transcript=required_text(raw, "referenceText"),
    )


def required_text(raw: dict, key: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Voice preset manifest field is invalid: {key}")
    return value.strip()
