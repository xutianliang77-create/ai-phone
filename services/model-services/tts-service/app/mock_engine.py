from app.audio import sine_pcm16_base64
from app.schemas import TtsAudioPayload, TtsSynthesizeRequest, TtsSynthesizeResponse


class MockTtsEngine:
    def __init__(self, sample_rate: int = 16000) -> None:
        self.sample_rate = 24000 if sample_rate == 24000 else 16000

    def health(self) -> tuple[bool, str | None]:
        return True, None

    def sample_rates(self) -> tuple[int, int]:
        return self.sample_rate, self.sample_rate

    async def synthesize(
        self,
        request: TtsSynthesizeRequest,
    ) -> TtsSynthesizeResponse:
        duration_ms = min(1200, max(240, len(request.text) * 32))
        return TtsSynthesizeResponse(
            provider="mock",
            model="mock-tts-v0.1.0",
            voiceMode=request.voice.mode if request.voice else "preset",
            voiceProfileId=request.voice.voiceProfileId if request.voice else None,
            presetId=request.voice.presetId if request.voice else None,
            firstAudioMs=1,
            audioDurationMs=duration_ms,
            modelSampleRate=self.sample_rate,
            outputSampleRate=self.sample_rate,
            audio=TtsAudioPayload(
                sampleRate=self.sample_rate,
                data=sine_pcm16_base64(
                    sample_rate=self.sample_rate,
                    duration_ms=duration_ms,
                    frequency_hz=420 if request.language == "zh" else 520,
                ),
            ),
        )
