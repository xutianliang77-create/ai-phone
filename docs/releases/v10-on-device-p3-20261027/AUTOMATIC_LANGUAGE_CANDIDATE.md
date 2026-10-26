# Automatic Chinese/English candidate

This is a source/host candidate, not device or release qualification.

The selected Apple API constructs a transcriber for a specific locale. Passing
`auto` to that initializer cannot enable language detection. The candidate keeps
one microphone, PCM queue and VAD owner, and supplies the same capture to two
SpeechTranscriber modules in one SpeechAnalyzer. It does not override the
system's analysis resource limits. A preparation/start failure preserves its
native cause and waits for capture cancellation before releasing the reference.
Automatic mode does not repeatedly restart an insufficient-resource session.

Each lane requests actual transcription-confidence and audio-time attributes.
Routing uses finalized model ranges and VAD-bounded turns, not wall time or the
transcript script alone. Both actual finalization watermarks must cover a turn.
The current QA policy requires complete confidence attributes, sufficient audio
coverage, confidence >=0.72 and a >=0.12 winning margin; script can reject an
implausible candidate. Uncertain, digit-only ambiguous or missing-lane turns do
not produce guessed translations. Missing completion evidence has a bounded
two-second wait. These thresholds are uncalibrated candidate policy, not an
accuracy guarantee.

Volatile results are retained locally. This initial automatic candidate commits
only finalized VAD turns; unlike fixed-source mode it does not yet provide
provisional bilingual captions for barge-in. This adds an important device
latency/interrupt acceptance item. Continuous speech must not be silently cut
at an arbitrary time or have words summarized to satisfy a duration target.
Candidate and pending-turn stores are bounded and fail explicitly on overflow.

Unqualified real behavior includes confidence availability/comparability,
two-locale preparation and resource availability on iPhone14Pro, code-switching,
numbers/negations, long continuous turns, speech during TTS, actual interrupt
delay, heat, battery and 30-minute stability. Reject rate as well as wrong-route
rate must be measured. If the device cannot meet the original quality/latency
target, report that gap; do not silently lower thresholds, switch to cloud, or
claim synthetic tests prove audio accuracy. Fixed Chinese/English remains the
candidate default until the device gate is approved and completed.

References:

- [Apple SpeechTranscriber](https://developer.apple.com/documentation/speech/speechtranscriber)
- [Apple SpeechAnalyzer module/resource limits](https://developer.apple.com/documentation/speech/speechanalyzer/setmodules(_:))
- [Apple transcription confidence](https://developer.apple.com/documentation/speech/speechtranscriber/resultattributeoption/transcriptionconfidence)

Pure routing regressions live in
`services/v10-device-control/test/native-language-router-main.swift`. They use
synthetic hypotheses and never execute a speech model.
