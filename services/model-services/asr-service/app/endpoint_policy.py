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
            "fingerprint": self.fingerprint,
        }


def uniform_endpoint_policies(
    min_audio_ms: int,
    endpoint_silence_ms: int,
    max_audio_ms: int,
    preroll_ms: int,
) -> dict[str, EndpointPolicy]:
    return {
        mode: EndpointPolicy(
            mode=mode,
            min_audio_ms=min_audio_ms,
            endpoint_silence_ms=endpoint_silence_ms,
            max_audio_ms=max_audio_ms,
            preroll_ms=preroll_ms,
        )
        for mode in ASR_ENDPOINT_MODES
    }
