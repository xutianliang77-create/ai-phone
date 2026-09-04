from app.audio_buffer import PcmSessionBuffer, RealtimePcmSegmenter, audio_duration_ms
from app.endpoint_policy import EndpointPolicy
from tests.audio_buffer_support import (
    TrackingVadProvider,
    ThresholdAwareVadProvider,
    realtime_segmenter,
    request,
    silence_pcm,
    voice_pcm,
)


def test_audio_duration_ms_for_pcm16_mono() -> None:
    assert audio_duration_ms(b"\0" * 1920, 24000) == 40


def test_buffer_returns_audio_after_min_duration() -> None:
    buffer = PcmSessionBuffer(min_audio_ms=80)

    first = buffer.append(request(sequence=1))
    second = buffer.append(request(sequence=2))

    assert first is None
    assert second == b"\0" * 3840


def test_buffer_ignores_duplicate_sequences() -> None:
    buffer = PcmSessionBuffer(min_audio_ms=40)

    buffer.append(request(sequence=1))
    duplicate = buffer.append(request(sequence=1))

    assert duplicate is None


def test_realtime_segmenter_waits_for_voice() -> None:
    segmenter = realtime_segmenter()

    segment = segmenter.append(request(sequence=1, pcm=silence_pcm()))

    assert segment is None


def test_realtime_segmenter_emits_after_endpoint_silence() -> None:
    segmenter = realtime_segmenter(min_audio_ms=120, endpoint_silence_ms=80)

    assert segmenter.append(request(sequence=1, pcm=voice_pcm())) is None
    assert segmenter.append(request(sequence=2, pcm=silence_pcm())) is None
    segment = segmenter.append(request(sequence=3, pcm=silence_pcm()))

    assert segment is not None
    assert segment.end_sequence == 3
    assert segment.duration_ms == 120
    assert segment.pcm == voice_pcm() + silence_pcm() * 2
    assert segment.endpoint_reason == "silence"


def test_realtime_segmenter_flushes_at_max_window() -> None:
    segmenter = realtime_segmenter(
        min_audio_ms=1000,
        endpoint_silence_ms=1000,
        max_audio_ms=120,
    )

    assert segmenter.append(request(sequence=1, pcm=voice_pcm())) is None
    assert segmenter.append(request(sequence=2, pcm=voice_pcm())) is None
    segment = segmenter.append(request(sequence=3, pcm=voice_pcm()))

    assert segment is not None
    assert segment.duration_ms == 120
    assert segment.endpoint_reason == "max_duration"


def test_realtime_segmenter_flushes_active_speech() -> None:
    segmenter = realtime_segmenter(min_audio_ms=1000, endpoint_silence_ms=1000)

    assert segmenter.append(request(sequence=1, pcm=voice_pcm())) is None
    segment = segmenter.flush("sess_1")

    assert segment is not None
    assert segment.end_sequence == 1
    assert segment.duration_ms == 40
    assert segment.pcm == voice_pcm()
    assert segment.endpoint_reason == "flush"


def test_realtime_segmenter_requires_minimum_voiced_duration() -> None:
    segmenter = RealtimePcmSegmenter(
        min_audio_ms=120,
        endpoint_silence_ms=80,
        max_audio_ms=1000,
        preroll_ms=40,
        vad_energy_threshold=350,
        endpoint_policies={
            "conversation": EndpointPolicy("conversation", 120, 80, 1000, 40),
            "listening": EndpointPolicy("listening", 120, 80, 1000, 40),
            "call_link": EndpointPolicy(
                "call_link", 120, 80, 1000, 40, min_voiced_ms=80
            ),
            "pstn": EndpointPolicy("pstn", 120, 80, 1000, 40),
        },
    )

    assert segmenter.append(request(1, voice_pcm(), mode="call_link")) is None
    assert segmenter.append(request(2, silence_pcm(), mode="call_link")) is None
    assert segmenter.append(request(3, silence_pcm(), mode="call_link")) is None

    assert segmenter.append(request(4, voice_pcm(), mode="call_link")) is None
    assert segmenter.append(request(5, voice_pcm(), mode="call_link")) is None
    assert segmenter.append(request(6, silence_pcm(), mode="call_link")) is None
    segment = segmenter.append(request(7, silence_pcm(), mode="call_link"))

    assert segment is not None
    assert segment.duration_ms == 160
    assert segment.pcm == voice_pcm() * 2 + silence_pcm() * 2


def test_realtime_segmenter_discards_short_voiced_flush() -> None:
    segmenter = RealtimePcmSegmenter(
        min_audio_ms=1000,
        endpoint_silence_ms=1000,
        max_audio_ms=2000,
        preroll_ms=40,
        vad_energy_threshold=350,
        endpoint_policies={
            "conversation": EndpointPolicy("conversation", 1000, 1000, 2000, 40),
            "listening": EndpointPolicy("listening", 1000, 1000, 2000, 40),
            "call_link": EndpointPolicy(
                "call_link", 1000, 1000, 2000, 40, min_voiced_ms=80
            ),
            "pstn": EndpointPolicy("pstn", 1000, 1000, 2000, 40),
        },
    )

    assert segmenter.append(request(1, voice_pcm(), mode="call_link")) is None
    assert segmenter.flush("sess_1") is None


def test_realtime_segmenter_does_not_flush_leading_silence() -> None:
    segmenter = realtime_segmenter(min_audio_ms=1000, endpoint_silence_ms=1000)

    assert segmenter.append(request(sequence=1, pcm=silence_pcm())) is None

    assert segmenter.flush("sess_1") is None


def test_realtime_segmenter_ignores_duplicate_sequences() -> None:
    segmenter = realtime_segmenter(min_audio_ms=40, endpoint_silence_ms=0)

    first = segmenter.append(request(sequence=1, pcm=voice_pcm()))
    duplicate = segmenter.append(request(sequence=1, pcm=voice_pcm()))

    assert first is not None
    assert duplicate is None


def test_realtime_segmenter_commits_audio_at_speaker_boundary() -> None:
    segmenter = realtime_segmenter(min_audio_ms=1000, endpoint_silence_ms=1000)

    assert segmenter.append(request(1, voice_pcm(), timestamp_ms=1000)) is None
    assert segmenter.append(request(2, voice_pcm(), timestamp_ms=1040)) is None
    assert segmenter.append(request(3, voice_pcm(), timestamp_ms=1080)) is None

    previous_turn = segmenter.commit_boundary("sess_1", 1080)
    next_turn = segmenter.flush("sess_1")

    assert previous_turn is not None
    assert previous_turn.pcm == voice_pcm() * 2
    assert previous_turn.start_timestamp_ms == 1000
    assert previous_turn.end_timestamp_ms == 1080
    assert previous_turn.endpoint_reason == "speaker_boundary"
    assert next_turn is not None
    assert next_turn.pcm == voice_pcm()
    assert next_turn.start_timestamp_ms == 1080
    assert next_turn.end_timestamp_ms == 1120


def test_speaker_boundary_does_not_reset_continuous_vad_state() -> None:
    vad = TrackingVadProvider()
    segmenter = RealtimePcmSegmenter(
        min_audio_ms=1000,
        endpoint_silence_ms=1000,
        max_audio_ms=2000,
        preroll_ms=40,
        vad_energy_threshold=350,
        vad_provider=vad,
    )
    segmenter.append(request(1, voice_pcm(), timestamp_ms=1000))
    segmenter.append(request(2, voice_pcm(), timestamp_ms=1040))

    assert segmenter.commit_boundary("sess_1", 1040) is not None
    assert vad.reset_count == 0


def test_endpoint_policy_is_frozen_and_isolated_per_session() -> None:
    segmenter = RealtimePcmSegmenter(
        min_audio_ms=40,
        endpoint_silence_ms=80,
        max_audio_ms=1000,
        preroll_ms=40,
        vad_energy_threshold=350,
        endpoint_policies={
            "conversation": EndpointPolicy("conversation", 40, 80, 1000, 40),
            "listening": EndpointPolicy("listening", 40, 160, 1000, 40),
            "call_link": EndpointPolicy("call_link", 40, 40, 1000, 40),
            "pstn": EndpointPolicy("pstn", 40, 120, 1000, 40),
        },
    )

    assert segmenter.append(request(1, voice_pcm(), session_id="conversation")) is None
    assert segmenter.append(request(1, voice_pcm(), session_id="listening", mode="listening")) is None
    assert segmenter.append(request(1, voice_pcm(), session_id="call", mode="call_link")) is None
    assert segmenter.append(request(1, voice_pcm(), session_id="pstn", mode="pstn")) is None
    assert segmenter.append(request(2, silence_pcm(), session_id="conversation")) is None
    assert segmenter.append(request(2, silence_pcm(), session_id="listening", mode="listening")) is None
    assert segmenter.append(request(2, silence_pcm(), session_id="call", mode="call_link")) is not None
    assert segmenter.append(request(2, silence_pcm(), session_id="pstn", mode="pstn")) is None
    assert segmenter.append(request(3, silence_pcm(), session_id="conversation")) is not None
    assert segmenter.append(request(3, silence_pcm(), session_id="listening", mode="listening")) is None
    assert segmenter.append(request(3, silence_pcm(), session_id="pstn", mode="pstn")) is None
    assert segmenter.append(request(4, silence_pcm(), session_id="pstn", mode="pstn")) is not None
    assert segmenter.diagnostics("conversation")["endpointPolicy"]["mode"] == "conversation"
    assert segmenter.diagnostics("listening")["endpointPolicy"]["mode"] == "listening"
    assert segmenter.diagnostics("call")["endpointPolicy"]["mode"] == "call_link"
    assert segmenter.diagnostics("pstn")["endpointPolicy"]["mode"] == "pstn"


def test_vad_threshold_is_frozen_and_isolated_per_mode() -> None:
    vad = ThresholdAwareVadProvider(probability=0.1)
    segmenter = RealtimePcmSegmenter(
        min_audio_ms=1000,
        endpoint_silence_ms=1000,
        max_audio_ms=2000,
        preroll_ms=40,
        vad_energy_threshold=350,
        vad_provider=vad,
        endpoint_policies={
            "conversation": EndpointPolicy(
                "conversation", 1000, 1000, 2000, 40, 0.5
            ),
            "listening": EndpointPolicy(
                "listening", 1000, 1000, 2000, 40, 0.05
            ),
            "call_link": EndpointPolicy("call_link", 1000, 1000, 2000, 40, 0.5),
            "pstn": EndpointPolicy("pstn", 1000, 1000, 2000, 40, 0.5),
        },
    )

    segmenter.append(request(1, voice_pcm(), session_id="conversation"))
    segmenter.append(
        request(1, voice_pcm(), session_id="listening", mode="listening")
    )

    assert segmenter.frame_vad_decision("conversation").voiced is False
    assert segmenter.frame_vad_decision("listening").voiced is True
    assert vad.thresholds == {"conversation": 0.5, "listening": 0.05}
    assert (
        segmenter.diagnostics("listening")["endpointPolicy"]["vadThreshold"]
        == 0.05
    )


def test_endpoint_mode_cannot_change_inside_session() -> None:
    segmenter = realtime_segmenter()
    segmenter.append(request(1, voice_pcm(), mode="conversation"))

    try:
        segmenter.append(request(2, voice_pcm(), mode="listening"))
    except ValueError as error:
        assert "cannot change" in str(error)
    else:
        raise AssertionError("mode change must be rejected")


def test_segment_vad_context_contains_only_segment_fingerprints() -> None:
    segmenter = realtime_segmenter()
    segmenter.append(request(1, voice_pcm()))

    context = segmenter.segment_vad_context("sess_1", "flush")

    assert context["endpointReason"] == "flush"
    assert len(context["endpointPolicyFingerprint"]) == 64
    assert "probabilityMean" not in context


def test_latest_frame_vad_decision_survives_segment_emission() -> None:
    vad = TrackingVadProvider()
    segmenter = RealtimePcmSegmenter(
        min_audio_ms=40,
        endpoint_silence_ms=40,
        max_audio_ms=80,
        preroll_ms=40,
        vad_energy_threshold=350,
        vad_provider=vad,
    )

    segmenter.append(request(7, voice_pcm(), timestamp_ms=1200))
    decision = segmenter.frame_vad_decision("sess_1")

    assert decision is not None
    assert decision.sequence == 7
    assert decision.timestamp_ms == 1200
    assert decision.duration_ms == 40
    assert decision.voiced is True
    assert decision.speech_probability == 0.9
    assert decision.provider == "tracking"
    assert decision.preroll_ms == 40
