from dataclasses import asdict, dataclass
from hashlib import sha256
import json


ASR_ENDPOINT_MODES = ("conversation", "listening", "call_link", "pstn")


@dataclass(frozen=True)
class EndpointPolicy:
    mode: str
    min_audio_ms: int
    endpoint_silence_ms: int
    max_audio_ms: int
    preroll_ms: int
    vad_threshold: float | None = None
    min_voiced_ms: int = 0

    @property
    def fingerprint(self) -> str:
        payload = json.dumps(asdict(self), sort_keys=True, separators=(",", ":"))
        return sha256(payload.encode("utf-8")).hexdigest()

    def diagnostics(self) -> dict[str, object]:
        return {
            "mode": self.mode,
            "minAudioMs": self.min_audio_ms,
            "endpointSilenceMs": self.endpoint_silence_ms,
            "maxAudioMs": self.max_audio_ms,
            "prerollMs": self.preroll_ms,
            "vadThreshold": self.vad_threshold,
            "minVoicedMs": self.min_voiced_ms,
            "fingerprint": self.fingerprint,
        }


def uniform_endpoint_policies(
    min_audio_ms: int,
    endpoint_silence_ms: int,
    max_audio_ms: int,
    preroll_ms: int,
    vad_threshold: float | None = None,
    min_voiced_ms: int = 0,
) -> dict[str, EndpointPolicy]:
    return {
        mode: EndpointPolicy(
            mode=mode,
            min_audio_ms=min_audio_ms,
            endpoint_silence_ms=endpoint_silence_ms,
            max_audio_ms=max_audio_ms,
            preroll_ms=preroll_ms,
            vad_threshold=vad_threshold,
            min_voiced_ms=min_voiced_ms,
        )
        for mode in ASR_ENDPOINT_MODES
    }


def segment_vad_context(
    diagnostics: dict[str, object],
    endpoint_reason: str,
) -> dict[str, object]:
    policy = diagnostics["endpointPolicy"]
    return {
        "endpointReason": endpoint_reason,
        "endpointPolicyFingerprint": policy["fingerprint"],
        **(
            {"vadModelFingerprint": diagnostics["modelFingerprint"]}
            if diagnostics.get("modelFingerprint") else {}
        ),
    }
